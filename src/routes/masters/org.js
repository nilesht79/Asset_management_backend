const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { connectDB, sql } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { validatePagination } = require('../../middleware/validation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /masters/org
 * Get all ORG/SUB_ORG entries with pagination
 */
router.get('/',
  requireRole(['admin', 'superadmin']),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { search, is_active } = req.query;

    const pool = await connectDB();

    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (org_code LIKE @search OR org_name LIKE @search OR sub_org_code LIKE @search OR sub_org_name LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (is_active !== undefined) {
      whereClause += ' AND is_active = @is_active';
      params.push({ name: 'is_active', type: sql.Bit, value: is_active === 'true' ? 1 : 0 });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(p => countRequest.input(p.name, p.type, p.value));
    const countResult = await countRequest.query(`SELECT COUNT(*) as total FROM ORG_MASTER WHERE ${whereClause}`);
    const total = countResult.recordset[0].total;

    // Get paginated data
    const dataRequest = pool.request();
    params.forEach(p => dataRequest.input(p.name, p.type, p.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const result = await dataRequest.query(`
      SELECT id, org_code, org_name, sub_org_code, sub_org_name, is_default, is_active, created_at, updated_at
      FROM ORG_MASTER
      WHERE ${whereClause}
      ORDER BY is_default DESC, org_code, sub_org_code
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      orgs: result.recordset.map(o => ({
        id: o.id,
        orgCode: o.org_code,
        orgName: o.org_name,
        subOrgCode: o.sub_org_code,
        subOrgName: o.sub_org_name,
        isDefault: o.is_default,
        isActive: o.is_active,
        createdAt: o.created_at,
        updatedAt: o.updated_at
      })),
      pagination
    }, 'Organizations retrieved successfully');
  })
);

/**
 * GET /masters/org/default
 * Get the default ORG/SUB_ORG for asset code generation
 */
router.get('/default',
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request()
      .query(`
        SELECT TOP 1 id, org_code, org_name, sub_org_code, sub_org_name
        FROM ORG_MASTER
        WHERE is_default = 1 AND is_active = 1
      `);

    if (result.recordset.length === 0) {
      // Return defaults if none set
      return sendSuccess(res, {
        orgCode: 'CID',
        subOrgCode: '0',
        orgName: 'Default',
        subOrgName: 'Default'
      }, 'Default organization codes');
    }

    const org = result.recordset[0];
    sendSuccess(res, {
      id: org.id,
      orgCode: org.org_code,
      orgName: org.org_name,
      subOrgCode: org.sub_org_code,
      subOrgName: org.sub_org_name
    }, 'Default organization retrieved');
  })
);

/**
 * GET /masters/org/:id
 * Get single ORG entry by ID
 */
router.get('/:id',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, org_code, org_name, sub_org_code, sub_org_name, is_default, is_active, created_at, updated_at
        FROM ORG_MASTER
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Organization not found');
    }

    const org = result.recordset[0];
    sendSuccess(res, {
      id: org.id,
      orgCode: org.org_code,
      orgName: org.org_name,
      subOrgCode: org.sub_org_code,
      subOrgName: org.sub_org_name,
      isDefault: org.is_default,
      isActive: org.is_active,
      createdAt: org.created_at,
      updatedAt: org.updated_at
    }, 'Organization retrieved successfully');
  })
);

/**
 * POST /masters/org
 * Create new ORG/SUB_ORG entry
 */
router.post('/',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { orgCode, orgName, subOrgCode, subOrgName, isDefault = false } = req.body;

    // Validation
    if (!orgCode || !orgName || !subOrgCode) {
      return sendError(res, 'orgCode, orgName, and subOrgCode are required', 400);
    }

    if (orgCode.length > 10) {
      return sendError(res, 'orgCode must be 10 characters or less', 400);
    }

    if (subOrgCode.length > 5) {
      return sendError(res, 'subOrgCode must be 5 characters or less', 400);
    }

    const pool = await connectDB();

    // Check for duplicate
    const existing = await pool.request()
      .input('org_code', sql.VarChar(10), orgCode)
      .input('sub_org_code', sql.VarChar(5), subOrgCode)
      .query(`
        SELECT id FROM ORG_MASTER
        WHERE org_code = @org_code AND sub_org_code = @sub_org_code
      `);

    if (existing.recordset.length > 0) {
      return sendConflict(res, `Organization with code ${orgCode}/${subOrgCode} already exists`);
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // If setting as default, clear existing default
      if (isDefault) {
        await transaction.request()
          .query('UPDATE ORG_MASTER SET is_default = 0 WHERE is_default = 1');
      }

      const newId = uuidv4();
      await transaction.request()
        .input('id', sql.UniqueIdentifier, newId)
        .input('org_code', sql.VarChar(10), orgCode.toUpperCase())
        .input('org_name', sql.VarChar(100), orgName)
        .input('sub_org_code', sql.VarChar(5), subOrgCode)
        .input('sub_org_name', sql.VarChar(100), subOrgName || null)
        .input('is_default', sql.Bit, isDefault ? 1 : 0)
        .query(`
          INSERT INTO ORG_MASTER (id, org_code, org_name, sub_org_code, sub_org_name, is_default, is_active)
          VALUES (@id, @org_code, @org_name, @sub_org_code, @sub_org_name, @is_default, 1)
        `);

      await transaction.commit();

      sendCreated(res, {
        id: newId,
        orgCode: orgCode.toUpperCase(),
        orgName,
        subOrgCode,
        subOrgName,
        isDefault
      }, 'Organization created successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * PUT /masters/org/:id
 * Update ORG/SUB_ORG entry
 */
router.put('/:id',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { orgCode, orgName, subOrgCode, subOrgName, isDefault, isActive } = req.body;

    const pool = await connectDB();

    // Check if exists
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM ORG_MASTER WHERE id = @id');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Organization not found');
    }

    // Check for duplicate if changing codes
    if (orgCode && subOrgCode) {
      const duplicate = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('org_code', sql.VarChar(10), orgCode)
        .input('sub_org_code', sql.VarChar(5), subOrgCode)
        .query(`
          SELECT id FROM ORG_MASTER
          WHERE org_code = @org_code AND sub_org_code = @sub_org_code AND id != @id
        `);

      if (duplicate.recordset.length > 0) {
        return sendConflict(res, `Organization with code ${orgCode}/${subOrgCode} already exists`);
      }
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // If setting as default, clear existing default
      if (isDefault === true) {
        await transaction.request()
          .input('id', sql.UniqueIdentifier, id)
          .query('UPDATE ORG_MASTER SET is_default = 0 WHERE is_default = 1 AND id != @id');
      }

      // Build update query
      const updates = [];
      const updateRequest = transaction.request().input('id', sql.UniqueIdentifier, id);

      if (orgCode !== undefined) {
        updates.push('org_code = @org_code');
        updateRequest.input('org_code', sql.VarChar(10), orgCode.toUpperCase());
      }
      if (orgName !== undefined) {
        updates.push('org_name = @org_name');
        updateRequest.input('org_name', sql.VarChar(100), orgName);
      }
      if (subOrgCode !== undefined) {
        updates.push('sub_org_code = @sub_org_code');
        updateRequest.input('sub_org_code', sql.VarChar(5), subOrgCode);
      }
      if (subOrgName !== undefined) {
        updates.push('sub_org_name = @sub_org_name');
        updateRequest.input('sub_org_name', sql.VarChar(100), subOrgName);
      }
      if (isDefault !== undefined) {
        updates.push('is_default = @is_default');
        updateRequest.input('is_default', sql.Bit, isDefault ? 1 : 0);
      }
      if (isActive !== undefined) {
        updates.push('is_active = @is_active');
        updateRequest.input('is_active', sql.Bit, isActive ? 1 : 0);
      }

      updates.push('updated_at = GETUTCDATE()');

      await updateRequest.query(`
        UPDATE ORG_MASTER SET ${updates.join(', ')} WHERE id = @id
      `);

      await transaction.commit();

      // Fetch updated record
      const result = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT * FROM ORG_MASTER WHERE id = @id');

      const org = result.recordset[0];
      sendSuccess(res, {
        id: org.id,
        orgCode: org.org_code,
        orgName: org.org_name,
        subOrgCode: org.sub_org_code,
        subOrgName: org.sub_org_name,
        isDefault: org.is_default,
        isActive: org.is_active,
        updatedAt: org.updated_at
      }, 'Organization updated successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * DELETE /masters/org/:id
 * Delete ORG/SUB_ORG entry (soft delete by setting is_active = 0)
 */
router.delete('/:id',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if exists
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, is_default FROM ORG_MASTER WHERE id = @id');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Organization not found');
    }

    // Cannot delete default org
    if (existing.recordset[0].is_default) {
      return sendError(res, 'Cannot delete the default organization. Set another organization as default first.', 400);
    }

    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('UPDATE ORG_MASTER SET is_active = 0, updated_at = GETUTCDATE() WHERE id = @id');

    sendSuccess(res, null, 'Organization deleted successfully');
  })
);

/**
 * POST /masters/org/:id/set-default
 * Set an ORG as the default for asset code generation
 */
router.post('/:id/set-default',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if exists and is active
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, org_code, sub_org_code, is_active FROM ORG_MASTER WHERE id = @id');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Organization not found');
    }

    if (!existing.recordset[0].is_active) {
      return sendError(res, 'Cannot set inactive organization as default', 400);
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Clear existing default
      await transaction.request()
        .query('UPDATE ORG_MASTER SET is_default = 0 WHERE is_default = 1');

      // Set new default
      await transaction.request()
        .input('id', sql.UniqueIdentifier, id)
        .query('UPDATE ORG_MASTER SET is_default = 1, updated_at = GETUTCDATE() WHERE id = @id');

      await transaction.commit();

      const org = existing.recordset[0];
      sendSuccess(res, {
        id: org.id,
        orgCode: org.org_code,
        subOrgCode: org.sub_org_code
      }, 'Default organization updated successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

module.exports = router;
