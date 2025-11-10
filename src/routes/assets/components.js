const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const validators = require('../../utils/validators');
const { logAssetAssignmentChange } = require('../../controllers/assetMovementController');

const router = express.Router({ mergeParams: true }); // mergeParams to access :id from parent router

// Apply authentication to all component routes
router.use(authenticateToken);

// ============================================================================
// GET /assets/:id/components - Get all components installed in an asset
// ============================================================================
router.get('/',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { include_removed } = req.query;

    const pool = await connectDB();

    // First check if parent asset exists
    const parentCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, asset_tag, asset_type FROM assets WHERE id = @id AND is_active = 1');

    if (parentCheck.recordset.length === 0) {
      return sendNotFound(res, 'Parent asset not found');
    }

    const parentAsset = parentCheck.recordset[0];

    // Build WHERE clause
    let whereClause = 'c.parent_asset_id = @parentId AND c.is_active = 1';
    if (!include_removed || include_removed === 'false') {
      whereClause += ' AND c.removal_date IS NULL';
    }

    // Get all components
    const result = await pool.request()
      .input('parentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          c.id,
          c.asset_tag,
          c.serial_number,
          c.tag_no,
          c.asset_type,
          c.status,
          c.condition_status,
          c.installation_date,
          c.removal_date,
          c.installation_notes,
          c.purchase_date,
          c.warranty_end_date,
          c.purchase_cost,
          c.created_at,
          c.updated_at,
          p.id as product_id,
          p.name as product_name,
          p.model as product_model,
          p.capacity_value,
          p.capacity_unit,
          p.speed_value,
          p.speed_unit,
          p.interface_type,
          p.form_factor,
          pt.name as product_type,
          cat.name as category_name,
          o.name as oem_name,
          installer.first_name + ' ' + installer.last_name as installed_by_name,
          installer.email as installed_by_email,
          CASE
            WHEN c.removal_date IS NOT NULL THEN 'removed'
            WHEN c.installation_date IS NOT NULL THEN 'installed'
            ELSE 'pending'
          END as installation_status
        FROM assets c
        INNER JOIN products p ON c.product_id = p.id
        LEFT JOIN product_types pt ON p.type_id = pt.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN USER_MASTER installer ON c.installed_by = installer.user_id
        WHERE ${whereClause}
        ORDER BY c.installation_date DESC, c.created_at DESC
      `);

    sendSuccess(res, {
      parent_asset: {
        id: parentAsset.id,
        asset_tag: parentAsset.asset_tag,
        asset_type: parentAsset.asset_type
      },
      components: result.recordset,
      total: result.recordset.length
    }, 'Components retrieved successfully');
  })
);

// ============================================================================
// GET /assets/:id/hierarchy - Get full asset hierarchy tree
// ============================================================================
router.get('/hierarchy',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if asset exists
    const assetCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, asset_tag FROM assets WHERE id = @id AND is_active = 1');

    if (assetCheck.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    // Use stored procedure to get hierarchy
    const result = await pool.request()
      .input('asset_id', sql.UniqueIdentifier, id)
      .execute('sp_get_asset_hierarchy');

    sendSuccess(res, {
      hierarchy: result.recordset
    }, 'Asset hierarchy retrieved successfully');
  })
);

// ============================================================================
// POST /assets/:id/components - Install a component into an asset
// ============================================================================
router.post('/',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.asset.installComponent),
  asyncHandler(async (req, res) => {
    const { id: parentId } = req.params;
    const { component_asset_id, installation_notes, installed_by } = req.body;
    const performedBy = installed_by || req.user?.id;

    if (!performedBy) {
      return sendError(res, 'User authentication required', 401);
    }

    const pool = await connectDB();

    // Validate the installation using stored procedure
    const validationResult = await pool.request()
      .input('component_id', sql.UniqueIdentifier, component_asset_id)
      .input('parent_id', sql.UniqueIdentifier, parentId)
      .output('is_valid', sql.Bit)
      .output('error_message', sql.VarChar(500))
      .execute('sp_validate_component_installation');

    const isValid = validationResult.output.is_valid;
    const errorMessage = validationResult.output.error_message;

    if (!isValid) {
      return sendError(res, errorMessage, 400);
    }

    // Begin transaction
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Update component asset
      await transaction.request()
        .input('componentId', sql.UniqueIdentifier, component_asset_id)
        .input('parentId', sql.UniqueIdentifier, parentId)
        .input('installationNotes', sql.Text, installation_notes)
        .input('installedBy', sql.UniqueIdentifier, performedBy)
        .query(`
          UPDATE assets
          SET parent_asset_id = @parentId,
              asset_type = 'component',
              installation_date = GETUTCDATE(),
              installation_notes = @installationNotes,
              installed_by = @installedBy,
              status = 'in_use',
              assigned_to = NULL,
              removal_date = NULL,
              updated_at = GETUTCDATE()
          WHERE id = @componentId
        `);

      // Get component details for logging
      const componentDetails = await transaction.request()
        .input('componentId', sql.UniqueIdentifier, component_asset_id)
        .query(`
          SELECT
            a.asset_tag,
            p.name as product_name
          FROM assets a
          INNER JOIN products p ON a.product_id = p.id
          WHERE a.id = @componentId
        `);

      const component = componentDetails.recordset[0];

      // Get parent details
      const parentDetails = await transaction.request()
        .input('parentId', sql.UniqueIdentifier, parentId)
        .query('SELECT asset_tag FROM assets WHERE id = @parentId');

      const parent = parentDetails.recordset[0];

      // Get performer details
      const performerDetails = await transaction.request()
        .input('performerId', sql.UniqueIdentifier, performedBy)
        .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @performerId');

      const performer = performerDetails.recordset[0];
      const performerName = performer ? `${performer.first_name} ${performer.last_name}` : 'System';

      // Log the component installation in asset movements
      await transaction.request()
        .input('assetId', sql.UniqueIdentifier, component_asset_id)
        .input('assetTag', sql.VarChar(50), component.asset_tag)
        .input('movementType', sql.VarChar(20), 'component_install')
        .input('status', sql.VarChar(20), 'in-use')
        .input('parentAssetId', sql.UniqueIdentifier, parentId)
        .input('parentAssetTag', sql.VarChar(50), parent.asset_tag)
        .input('reason', sql.Text, `Component installed into parent asset ${parent.asset_tag}`)
        .input('notes', sql.Text, installation_notes)
        .input('performedBy', sql.UniqueIdentifier, performedBy)
        .input('performedByName', sql.NVarChar(200), performerName)
        .query(`
          INSERT INTO ASSET_MOVEMENTS (
            asset_id, asset_tag, movement_type, status,
            parent_asset_id, parent_asset_tag,
            reason, notes, performed_by, performed_by_name, movement_date, created_at
          )
          VALUES (
            @assetId, @assetTag, @movementType, @status,
            @parentAssetId, @parentAssetTag,
            @reason, @notes, @performedBy, @performedByName, GETUTCDATE(), GETUTCDATE()
          )
        `);

      await transaction.commit();

      // Get updated component with full details
      const updatedComponent = await pool.request()
        .input('componentId', sql.UniqueIdentifier, component_asset_id)
        .query(`
          SELECT
            c.id,
            c.asset_tag,
            c.serial_number,
            c.asset_type,
            c.status,
            c.installation_date,
            c.installation_notes,
            p.name as product_name,
            p.model as product_model,
            installer.first_name + ' ' + installer.last_name as installed_by_name
          FROM assets c
          INNER JOIN products p ON c.product_id = p.id
          LEFT JOIN USER_MASTER installer ON c.installed_by = installer.user_id
          WHERE c.id = @componentId
        `);

      sendCreated(res, {
        component: updatedComponent.recordset[0],
        parent_asset_tag: parent.asset_tag
      }, 'Component installed successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// ============================================================================
// DELETE /assets/:id/components/:componentId - Remove a component from asset
// ============================================================================
router.delete('/:componentId',
  requireDynamicPermission(),
  validateUUID('id'),
  validateUUID('componentId'),
  asyncHandler(async (req, res) => {
    const { id: parentId, componentId } = req.params;
    const { removal_notes } = req.body || {};
    const performedBy = req.user?.user_id || req.user?.id;

    if (!performedBy) {
      return sendError(res, 'User authentication required', 401);
    }

    const pool = await connectDB();

    // Check if component exists and belongs to this parent
    const componentCheck = await pool.request()
      .input('componentId', sql.UniqueIdentifier, componentId)
      .input('parentId', sql.UniqueIdentifier, parentId)
      .query(`
        SELECT a.id, a.asset_tag, a.parent_asset_id, p.name as product_name
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        WHERE a.id = @componentId
          AND a.parent_asset_id = @parentId
          AND a.is_active = 1
          AND a.removal_date IS NULL
      `);

    if (componentCheck.recordset.length === 0) {
      return sendNotFound(res, 'Component not found or not installed in this asset');
    }

    const component = componentCheck.recordset[0];

    // Begin transaction
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Update component - remove from parent but keep as standalone asset
      await transaction.request()
        .input('componentId', sql.UniqueIdentifier, componentId)
        .input('removalNotes', sql.Text, removal_notes)
        .query(`
          UPDATE assets
          SET removal_date = GETUTCDATE(),
              asset_type = 'standalone',
              parent_asset_id = NULL,
              status = 'available',
              installation_notes = CONCAT(ISNULL(installation_notes, ''), CHAR(10), 'Removed: ', @removalNotes),
              updated_at = GETUTCDATE()
          WHERE id = @componentId
        `);

      // Get parent details for logging
      const parentDetails = await transaction.request()
        .input('parentId', sql.UniqueIdentifier, parentId)
        .query('SELECT asset_tag FROM assets WHERE id = @parentId');

      const parent = parentDetails.recordset[0];

      // Get performer details
      const performerDetails = await transaction.request()
        .input('performerId', sql.UniqueIdentifier, performedBy)
        .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @performerId');

      const performer = performerDetails.recordset[0];
      const performerName = performer ? `${performer.first_name} ${performer.last_name}` : 'System';

      // Log the component removal in asset movements
      await transaction.request()
        .input('assetId', sql.UniqueIdentifier, componentId)
        .input('assetTag', sql.VarChar(50), component.asset_tag)
        .input('movementType', sql.VarChar(20), 'component_remove')
        .input('status', sql.VarChar(20), 'available')
        .input('parentAssetId', sql.UniqueIdentifier, parentId)
        .input('parentAssetTag', sql.VarChar(50), parent.asset_tag)
        .input('reason', sql.Text, `Component removed from parent asset ${parent.asset_tag}`)
        .input('notes', sql.Text, removal_notes)
        .input('performedBy', sql.UniqueIdentifier, performedBy)
        .input('performedByName', sql.NVarChar(200), performerName)
        .query(`
          INSERT INTO ASSET_MOVEMENTS (
            asset_id, asset_tag, movement_type, status,
            parent_asset_id, parent_asset_tag,
            reason, notes, performed_by, performed_by_name, movement_date, created_at
          )
          VALUES (
            @assetId, @assetTag, @movementType, @status,
            @parentAssetId, @parentAssetTag,
            @reason, @notes, @performedBy, @performedByName, GETUTCDATE(), GETUTCDATE()
          )
        `);

      await transaction.commit();

      sendSuccess(res, {
        component_id: componentId,
        component_tag: component.asset_tag,
        parent_asset_tag: parent.asset_tag,
        removal_date: new Date()
      }, 'Component removed successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// ============================================================================
// POST /assets/:id/components/:componentId/reinstall - Reinstall a removed component
// ============================================================================
router.post('/:componentId/reinstall',
  requireDynamicPermission(),
  validateUUID('id'),
  validateUUID('componentId'),
  validateBody(validators.asset.installComponent),
  asyncHandler(async (req, res) => {
    const { id: parentId, componentId } = req.params;
    const { installation_notes, installed_by } = req.body;
    const performedBy = installed_by || req.user.user_id;

    const pool = await connectDB();

    // Check if component was previously installed and is now removed
    const componentCheck = await pool.request()
      .input('componentId', sql.UniqueIdentifier, componentId)
      .input('parentId', sql.UniqueIdentifier, parentId)
      .query(`
        SELECT a.id, a.asset_tag, a.removal_date
        FROM assets a
        WHERE a.id = @componentId
          AND a.parent_asset_id = @parentId
          AND a.is_active = 1
          AND a.removal_date IS NOT NULL
      `);

    if (componentCheck.recordset.length === 0) {
      return sendNotFound(res, 'Component not found or not previously installed in this asset');
    }

    // Reinstall the component
    await pool.request()
      .input('componentId', sql.UniqueIdentifier, componentId)
      .input('installationNotes', sql.Text, installation_notes)
      .input('installedBy', sql.UniqueIdentifier, performedBy)
      .query(`
        UPDATE assets
        SET removal_date = NULL,
            asset_type = 'component',
            installation_date = GETUTCDATE(),
            installation_notes = @installationNotes,
            installed_by = @installedBy,
            status = 'in_use',
            updated_at = GETUTCDATE()
        WHERE id = @componentId
      `);

    sendSuccess(res, {
      component_id: componentId,
      installation_date: new Date()
    }, 'Component reinstalled successfully');
  })
);

module.exports = router;
