const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { v4: uuidv4 } = require('uuid');
const { connectDB } = require('../../config/database');
const { asyncHandler } = require('../../middleware/error-handler');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { validatePagination } = require('../../middleware/validation');
const {
  generateDeliveryTicketNumber,
  isValidStatusTransition,
  logApprovalHistory
} = require('../../utils/requisition-helpers');
const requisitionNotificationService = require('../../services/requisitionNotificationService');

// GET /api/v1/requisitions/pending-assignments - Get all requisitions pending asset assignment
router.get(
  '/pending-assignments',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { page = 1, limit = 10, search, urgency, status } = req.query;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = `WHERE (r.status = 'pending_assignment' OR r.status = 'assigned')`;

    if (search) {
      whereClause += ` AND (
        r.requisition_number LIKE @search OR
        r.requester_name LIKE @search OR
        r.department_name LIKE @search
      )`;
    }

    if (urgency) {
      whereClause += ` AND r.urgency = @urgency`;
    }

    if (status) {
      whereClause += ` AND r.status = @status`;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ASSET_REQUISITIONS r
      ${whereClause}
    `;

    const countRequest = pool.request();
    if (search) countRequest.input('search', sql.VarChar, `%${search}%`);
    if (urgency) countRequest.input('urgency', sql.VarChar, urgency);
    if (status) countRequest.input('status', sql.VarChar, status);

    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].total;

    // Get requisitions
    const query = `
      SELECT
        r.*,
        c.name as category_name,
        pt.name as product_type_name,
        p.name as product_name,
        p.model as product_model
      FROM ASSET_REQUISITIONS r
      LEFT JOIN categories c ON r.asset_category_id = c.id
      LEFT JOIN product_types pt ON r.product_type_id = pt.id
      LEFT JOIN products p ON r.requested_product_id = p.id
      ${whereClause}
      ORDER BY
        CASE r.urgency
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        r.created_at ASC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const request = pool.request();
    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, parseInt(limit));
    if (search) request.input('search', sql.VarChar, `%${search}%`);
    if (urgency) request.input('urgency', sql.VarChar, urgency);
    if (status) request.input('status', sql.VarChar, status);

    const result = await request.query(query);

    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  })
);

// POST /api/v1/requisitions/assign-asset - Assign asset to requisition and create delivery ticket
router.post(
  '/assign-asset',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const userId = req.oauth.user.id;
    const userName = `${req.oauth.user.firstName} ${req.oauth.user.lastName}`;

    const {
      requisition_id,
      asset_id,
      engineer_id,
      installation_scheduled_date,
      installation_notes
    } = req.body;

    // Validation
    if (!requisition_id || !asset_id) {
      return res.status(400).json({
        success: false,
        message: 'Requisition ID and Asset ID are required'
      });
    }

    if (!engineer_id) {
      return res.status(400).json({
        success: false,
        message: 'Engineer assignment is required'
      });
    }

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // 1. Check requisition exists and is pending assignment
      const reqResult = await transaction.request()
        .input('requisition_id', sql.UniqueIdentifier, requisition_id)
        .query(`
          SELECT * FROM ASSET_REQUISITIONS
          WHERE requisition_id = @requisition_id
        `);

      if (reqResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }

      const requisition = reqResult.recordset[0];

      // Validate status transition
      if (!isValidStatusTransition(requisition.status, 'assigned')) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Cannot assign asset from status: ${requisition.status}`
        });
      }

      // 2. Check asset exists and is available
      const assetResult = await transaction.request()
        .input('asset_id', sql.UniqueIdentifier, asset_id)
        .query(`
          SELECT * FROM assets
          WHERE id = @asset_id
        `);

      if (assetResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Asset not found'
        });
      }

      const asset = assetResult.recordset[0];

      if (asset.status !== 'available') {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Asset is not available. Current status: ${asset.status}`
        });
      }

      // 3. Check engineer exists and has engineer role
      const engineerResult = await transaction.request()
        .input('engineer_id', sql.UniqueIdentifier, engineer_id)
        .query(`
          SELECT user_id, first_name, last_name, role
          FROM USER_MASTER
          WHERE user_id = @engineer_id AND role = 'engineer' AND is_active = 1
        `);

      if (engineerResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Engineer not found or not active'
        });
      }

      const engineer = engineerResult.recordset[0];
      const engineerName = `${engineer.first_name} ${engineer.last_name}`;

      // 4. Generate delivery ticket number
      const deliveryTicketNumber = await generateDeliveryTicketNumber(pool);

      // 5. Create delivery ticket with engineer assignment
      const ticketResult = await transaction.request()
        .input('ticket_number', sql.VarChar, deliveryTicketNumber)
        .input('requisition_id', sql.UniqueIdentifier, requisition_id)
        .input('asset_id', sql.UniqueIdentifier, asset_id)
        .input('asset_tag', sql.VarChar, asset.asset_tag)
        .input('user_id', sql.UniqueIdentifier, requisition.requested_by)
        .input('user_name', sql.NVarChar, requisition.requester_name)
        .input('delivery_type', sql.VarChar, 'physical')
        .input('scheduled_delivery_date', sql.DateTime, installation_scheduled_date || null)
        .input('delivered_by', sql.UniqueIdentifier, engineer_id)
        .input('delivered_by_name', sql.NVarChar, engineerName)
        .input('delivery_notes', sql.Text, installation_notes || null)
        .input('status', sql.VarChar, 'in_transit')
        .query(`
          INSERT INTO ASSET_DELIVERY_TICKETS (
            ticket_number,
            requisition_id,
            asset_id,
            asset_tag,
            user_id,
            user_name,
            delivery_type,
            scheduled_delivery_date,
            delivered_by,
            delivered_by_name,
            delivery_notes,
            status,
            created_at
          )
          OUTPUT INSERTED.ticket_id
          VALUES (
            @ticket_number,
            @requisition_id,
            @asset_id,
            @asset_tag,
            @user_id,
            @user_name,
            @delivery_type,
            @scheduled_delivery_date,
            @delivered_by,
            @delivered_by_name,
            @delivery_notes,
            @status,
            GETUTCDATE()
          )
        `);

      const deliveryTicketId = ticketResult.recordset[0].ticket_id;

      // 6. Update requisition with assignment and engineer details
      await transaction.request()
        .input('requisition_id', sql.UniqueIdentifier, requisition_id)
        .input('assigned_coordinator_id', sql.UniqueIdentifier, userId)
        .input('assigned_coordinator_name', sql.NVarChar, userName)
        .input('assigned_asset_id', sql.UniqueIdentifier, asset_id)
        .input('assigned_asset_tag', sql.VarChar, asset.asset_tag)
        .input('assigned_engineer_id', sql.UniqueIdentifier, engineer_id)
        .input('assigned_engineer_name', sql.NVarChar, engineerName)
        .input('installation_scheduled_date', sql.DateTime, installation_scheduled_date || null)
        .input('delivery_ticket_id', sql.UniqueIdentifier, deliveryTicketId)
        .input('assignment_notes', sql.Text, installation_notes || null)
        .input('status', sql.VarChar, 'assigned')
        .input('assignment_date', sql.DateTime, new Date())
        .query(`
          UPDATE ASSET_REQUISITIONS
          SET
            assigned_coordinator_id = @assigned_coordinator_id,
            assigned_coordinator_name = @assigned_coordinator_name,
            assigned_asset_id = @assigned_asset_id,
            assigned_asset_tag = @assigned_asset_tag,
            assigned_engineer_id = @assigned_engineer_id,
            assigned_engineer_name = @assigned_engineer_name,
            installation_scheduled_date = @installation_scheduled_date,
            delivery_ticket_id = @delivery_ticket_id,
            assignment_notes = @assignment_notes,
            status = @status,
            assignment_date = @assignment_date,
            updated_at = GETUTCDATE()
          WHERE requisition_id = @requisition_id
        `);

      // 7. Update asset status to 'in_transit' (NOT assigned yet - assignment happens after verification)
      await transaction.request()
        .input('asset_id', sql.UniqueIdentifier, asset_id)
        .input('status', sql.VarChar, 'in_transit')
        .query(`
          UPDATE assets
          SET
            assigned_to = NULL,
            status = @status,
            updated_at = GETUTCDATE()
          WHERE id = @asset_id
        `);

      // 7.5 Create asset movement record for tracking
      // Get requester's location
      const requesterResult = await transaction.request()
        .input('user_id', sql.UniqueIdentifier, requisition.requested_by)
        .query(`
          SELECT location_id, first_name, last_name
          FROM USER_MASTER
          WHERE user_id = @user_id
        `);

      const requesterLocationId = requesterResult.recordset[0]?.location_id || null;

      // Get location name if exists
      let locationName = null;
      if (requesterLocationId) {
        const locResult = await transaction.request()
          .input('location_id', sql.UniqueIdentifier, requesterLocationId)
          .query('SELECT name FROM LOCATIONS WHERE id = @location_id');
        locationName = locResult.recordset[0]?.name || null;
      }

      // Insert movement record
      const movementId = uuidv4();
      await transaction.request()
        .input('id', sql.UniqueIdentifier, movementId)
        .input('asset_id', sql.UniqueIdentifier, asset_id)
        .input('asset_tag', sql.VarChar, asset.asset_tag)
        .input('assigned_to', sql.UniqueIdentifier, requisition.requested_by)
        .input('assigned_to_name', sql.NVarChar, requisition.requester_name)
        .input('location_id', sql.UniqueIdentifier, requesterLocationId)
        .input('location_name', sql.NVarChar, locationName)
        .input('movement_type', sql.VarChar, 'assigned')
        .input('status', sql.VarChar, 'assigned')
        .input('reason', sql.NVarChar, `Asset assigned via requisition ${requisition.requisition_number}`)
        .input('notes', sql.NVarChar, installation_notes || null)
        .input('performed_by', sql.UniqueIdentifier, userId)
        .input('performed_by_name', sql.NVarChar, userName)
        .query(`
          INSERT INTO ASSET_MOVEMENTS (
            id, asset_id, asset_tag,
            assigned_to, assigned_to_name,
            location_id, location_name,
            movement_type, status,
            previous_user_id, previous_user_name,
            previous_location_id, previous_location_name,
            movement_date, reason, notes,
            performed_by, performed_by_name,
            created_at
          )
          VALUES (
            @id, @asset_id, @asset_tag,
            @assigned_to, @assigned_to_name,
            @location_id, @location_name,
            @movement_type, @status,
            NULL, NULL,
            NULL, NULL,
            GETUTCDATE(), @reason, @notes,
            @performed_by, @performed_by_name,
            GETUTCDATE()
          )
        `);

      // 8. Log in approval history
      await logApprovalHistory({
        pool: transaction,
        requisition_id,
        approval_level: 'coordinator',
        approver_id: userId,
        approver_name: userName,
        approver_role: 'coordinator',
        action: 'assigned',
        comments: installation_notes || `Asset assigned to ${requisition.requester_name}. Engineer ${engineerName} assigned for installation.`,
        previous_status: requisition.status,
        new_status: 'assigned'
      });

      await transaction.commit();

      // Send notifications to Employee and Engineer
      requisitionNotificationService.notifyAssetAssigned(requisition, {
        asset_tag: asset.asset_tag,
        engineer_id,
        engineer_name: engineerName,
        coordinator_name: userName,
        installation_scheduled_date
      });

      res.json({
        success: true,
        message: 'Asset assigned successfully. Engineer assigned for installation.',
        data: {
          requisition_id,
          asset_id,
          asset_tag: asset.asset_tag,
          engineer_id,
          engineer_name: engineerName,
          delivery_ticket_id: deliveryTicketId,
          delivery_ticket_number: deliveryTicketNumber,
          installation_scheduled_date
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

module.exports = router;
