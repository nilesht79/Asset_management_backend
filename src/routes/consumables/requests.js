const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { connectDB, sql } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { validatePagination } = require('../../middleware/validation');
const NotificationModel = require('../../models/notification');
const emailService = require('../../services/emailService');

const router = express.Router();

router.use(authenticateToken);

/**
 * Generate request number: CR-YYYYMMDD-XXXX
 */
async function generateRequestNumber(pool) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `CR-${today}`;

  const result = await pool.request()
    .input('prefix', sql.VarChar(20), `${prefix}%`)
    .query(`
      SELECT TOP 1 request_number FROM consumable_requests
      WHERE request_number LIKE @prefix
      ORDER BY request_number DESC
    `);

  if (result.recordset.length === 0) {
    return `${prefix}-0001`;
  }

  const lastNumber = result.recordset[0].request_number;
  const sequence = parseInt(lastNumber.split('-').pop()) + 1;
  return `${prefix}-${sequence.toString().padStart(4, '0')}`;
}

/**
 * GET /consumables/requests
 * Get all consumable requests with filters
 */
router.get('/',
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { status, requested_by, for_asset_id, consumable_id, priority, search } = req.query;

    const pool = await connectDB();
    const userId = req.user.id;
    const userRole = req.user.role;

    let whereClause = '1=1';
    const params = [];

    // Non-admin users can only see their own requests or requests they created
    if (!['admin', 'superadmin', 'coordinator'].includes(userRole)) {
      // Engineers can see requests they created on behalf of others OR their own requests
      if (userRole === 'engineer') {
        whereClause += ' AND (cr.requested_by = @user_id OR cr.created_by = @user_id)';
      } else {
        whereClause += ' AND cr.requested_by = @user_id';
      }
      params.push({ name: 'user_id', type: sql.UniqueIdentifier, value: userId });
    } else if (requested_by) {
      whereClause += ' AND cr.requested_by = @requested_by';
      params.push({ name: 'requested_by', type: sql.UniqueIdentifier, value: requested_by });
    }

    if (status) {
      whereClause += ' AND cr.status = @status';
      params.push({ name: 'status', type: sql.VarChar(30), value: status });
    }

    if (for_asset_id) {
      whereClause += ' AND cr.for_asset_id = @for_asset_id';
      params.push({ name: 'for_asset_id', type: sql.UniqueIdentifier, value: for_asset_id });
    }

    if (consumable_id) {
      whereClause += ' AND cr.consumable_id = @consumable_id';
      params.push({ name: 'consumable_id', type: sql.UniqueIdentifier, value: consumable_id });
    }

    if (priority) {
      whereClause += ' AND cr.priority = @priority';
      params.push({ name: 'priority', type: sql.VarChar(20), value: priority });
    }

    // Search filter - search by request number, consumable name, or requester name
    if (search) {
      whereClause += ` AND (
        cr.request_number LIKE @search OR
        c.name LIKE @search OR
        req.first_name + ' ' + req.last_name LIKE @search OR
        a.asset_tag LIKE @search
      )`;
      params.push({ name: 'search', type: sql.VarChar(100), value: `%${search}%` });
    }

    // Count query - include JOINs needed for search filter
    const countRequest = pool.request();
    params.forEach(p => countRequest.input(p.name, p.type, p.value));
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total FROM consumable_requests cr
      JOIN consumables c ON cr.consumable_id = c.id
      JOIN USER_MASTER req ON cr.requested_by = req.user_id
      LEFT JOIN assets a ON cr.for_asset_id = a.id
      WHERE ${whereClause}
    `);

    // Data query
    const dataRequest = pool.request();
    params.forEach(p => dataRequest.input(p.name, p.type, p.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const result = await dataRequest.query(`
      SELECT
        cr.*,
        c.name as consumable_name,
        c.sku as consumable_sku,
        cc.name as category_name,
        a.asset_tag,
        a.serial_number as asset_serial,
        p.name as asset_product_name,
        req.first_name + ' ' + req.last_name as requested_by_name,
        req.email as requested_by_email,
        req_loc.name as requester_location_name,
        req_loc.id as requester_location_id,
        app.first_name + ' ' + app.last_name as approved_by_name,
        eng.first_name + ' ' + eng.last_name as assigned_engineer_name,
        eng.email as assigned_engineer_email,
        creator.first_name + ' ' + creator.last_name as created_by_name
      FROM consumable_requests cr
      JOIN consumables c ON cr.consumable_id = c.id
      JOIN consumable_categories cc ON c.category_id = cc.id
      LEFT JOIN assets a ON cr.for_asset_id = a.id
      LEFT JOIN products p ON a.product_id = p.id
      JOIN USER_MASTER req ON cr.requested_by = req.user_id
      LEFT JOIN locations req_loc ON req.location_id = req_loc.id
      LEFT JOIN USER_MASTER app ON cr.approved_by = app.user_id
      LEFT JOIN USER_MASTER eng ON cr.assigned_engineer = eng.user_id
      LEFT JOIN USER_MASTER creator ON cr.created_by = creator.user_id
      WHERE ${whereClause}
      ORDER BY
        CASE cr.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        cr.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, countResult.recordset[0].total);

    sendSuccess(res, {
      requests: result.recordset,
      pagination
    }, 'Requests retrieved successfully');
  })
);

/**
 * GET /consumables/requests/my-requests
 * Get current user's consumable requests
 */
router.get('/my-requests',
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { status, priority, search } = req.query;
    const userId = req.user.id;

    const pool = await connectDB();

    let whereClause = 'cr.requested_by = @user_id';
    const params = [{ name: 'user_id', type: sql.UniqueIdentifier, value: userId }];

    if (status) {
      whereClause += ' AND cr.status = @status';
      params.push({ name: 'status', type: sql.VarChar(30), value: status });
    }

    if (priority) {
      whereClause += ' AND cr.priority = @priority';
      params.push({ name: 'priority', type: sql.VarChar(20), value: priority });
    }

    // Search filter - search by request number, consumable name, or asset tag
    if (search) {
      whereClause += ` AND (
        cr.request_number LIKE @search OR
        c.name LIKE @search OR
        a.asset_tag LIKE @search
      )`;
      params.push({ name: 'search', type: sql.VarChar(100), value: `%${search}%` });
    }

    const countRequest = pool.request();
    params.forEach(p => countRequest.input(p.name, p.type, p.value));
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total FROM consumable_requests cr
      JOIN consumables c ON cr.consumable_id = c.id
      LEFT JOIN assets a ON cr.for_asset_id = a.id
      WHERE ${whereClause}
    `);

    const dataRequest = pool.request();
    params.forEach(p => dataRequest.input(p.name, p.type, p.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const result = await dataRequest.query(`
      SELECT
        cr.*,
        c.name as consumable_name,
        cc.name as category_name,
        a.asset_tag
      FROM consumable_requests cr
      JOIN consumables c ON cr.consumable_id = c.id
      JOIN consumable_categories cc ON c.category_id = cc.id
      LEFT JOIN assets a ON cr.for_asset_id = a.id
      WHERE ${whereClause}
      ORDER BY cr.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, countResult.recordset[0].total);

    sendSuccess(res, { requests: result.recordset, pagination }, 'My requests retrieved');
  })
);

/**
 * GET /consumables/requests/engineers
 * Get list of engineers for assignment dropdown (must be before /:id route)
 */
router.get('/engineers',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        u.user_id as id,
        u.first_name as firstName,
        u.last_name as lastName,
        u.email,
        l.name as location_name,
        l.id as location_id
      FROM USER_MASTER u
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE u.role = 'engineer' AND u.is_active = 1
      ORDER BY u.first_name, u.last_name
    `);

    sendSuccess(res, result.recordset, 'Engineers retrieved');
  })
);

/**
 * GET /consumables/requests/:requestId/stock-info
 * Get stock availability info for a specific request (for approval modal)
 */
router.get('/:requestId/stock-info',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const pool = await connectDB();

    // Get request details with consumable and requester location
    const request = await pool.request()
      .input('id', sql.UniqueIdentifier, requestId)
      .query(`
        SELECT cr.consumable_id, cr.quantity_requested,
               c.name as consumable_name, c.sku, c.unit_of_measure,
               req.location_id as requester_location_id,
               req_loc.name as requester_location_name
        FROM consumable_requests cr
        JOIN consumables c ON cr.consumable_id = c.id
        JOIN USER_MASTER req ON cr.requested_by = req.user_id
        LEFT JOIN locations req_loc ON req.location_id = req_loc.id
        WHERE cr.id = @id
      `);

    if (request.recordset.length === 0) {
      return sendNotFound(res, 'Request not found');
    }

    const reqData = request.recordset[0];

    // Get stock at all locations for this consumable
    const stockResult = await pool.request()
      .input('consumable_id', sql.UniqueIdentifier, reqData.consumable_id)
      .query(`
        SELECT
          ci.location_id,
          l.name as location_name,
          ci.quantity_in_stock,
          COALESCE(ci.quantity_reserved, 0) as quantity_reserved,
          ci.quantity_in_stock - COALESCE(ci.quantity_reserved, 0) as available_stock
        FROM consumable_inventory ci
        LEFT JOIN locations l ON ci.location_id = l.id
        WHERE ci.consumable_id = @consumable_id
        ORDER BY ci.quantity_in_stock DESC
      `);

    // Check if there's sufficient stock at requester's location
    const requesterLocationStock = stockResult.recordset.find(
      s => s.location_id === reqData.requester_location_id
    );
    const hasSufficientAtRequesterLocation = requesterLocationStock
      ? requesterLocationStock.available_stock >= reqData.quantity_requested
      : false;

    // Check if there's sufficient stock anywhere
    const totalAvailable = stockResult.recordset.reduce((sum, s) => sum + s.available_stock, 0);
    const hasSufficientAnywhere = totalAvailable >= reqData.quantity_requested;

    sendSuccess(res, {
      consumable: {
        id: reqData.consumable_id,
        name: reqData.consumable_name,
        sku: reqData.sku,
        unit_of_measure: reqData.unit_of_measure
      },
      quantity_requested: reqData.quantity_requested,
      requester_location: {
        id: reqData.requester_location_id,
        name: reqData.requester_location_name
      },
      stock_by_location: stockResult.recordset,
      total_available: totalAvailable,
      has_sufficient_at_requester_location: hasSufficientAtRequesterLocation,
      has_sufficient_anywhere: hasSufficientAnywhere
    }, 'Stock info retrieved');
  })
);

/**
 * GET /consumables/requests/statistics/summary
 * Get request statistics for dashboard (must be before /:id route)
 */
router.get('/statistics/summary',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN priority = 'urgent' AND status IN ('pending', 'approved') THEN 1 ELSE 0 END) as urgent_pending
      FROM consumable_requests
      WHERE created_at >= DATEADD(day, -30, GETUTCDATE())
    `);

    sendSuccess(res, result.recordset[0], 'Statistics retrieved');
  })
);

/**
 * GET /consumables/requests/:id
 * Get single request details
 */
router.get('/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          cr.*,
          c.name as consumable_name,
          c.sku as consumable_sku,
          c.unit_of_measure,
          cc.name as category_name,
          a.asset_tag,
          a.serial_number as asset_serial,
          p.name as asset_product_name,
          o.name as asset_oem_name,
          req.first_name + ' ' + req.last_name as requested_by_name,
          req.email as requested_by_email,
          req_loc.id as requester_location_id,
          req_loc.name as requester_location_name,
          app.first_name + ' ' + app.last_name as approved_by_name,
          eng.first_name + ' ' + eng.last_name as assigned_engineer_name,
          eng.email as assigned_engineer_email,
          rcv.first_name + ' ' + rcv.last_name as received_by_name,
          creator.first_name + ' ' + creator.last_name as created_by_name
        FROM consumable_requests cr
        JOIN consumables c ON cr.consumable_id = c.id
        JOIN consumable_categories cc ON c.category_id = cc.id
        LEFT JOIN assets a ON cr.for_asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        JOIN USER_MASTER req ON cr.requested_by = req.user_id
        LEFT JOIN locations req_loc ON req.location_id = req_loc.id
        LEFT JOIN USER_MASTER app ON cr.approved_by = app.user_id
        LEFT JOIN USER_MASTER eng ON cr.assigned_engineer = eng.user_id
        LEFT JOIN USER_MASTER rcv ON cr.received_by = rcv.user_id
        LEFT JOIN USER_MASTER creator ON cr.created_by = creator.user_id
        WHERE cr.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Request not found');
    }

    sendSuccess(res, result.recordset[0], 'Request retrieved successfully');
  })
);

/**
 * POST /consumables/requests
 * Create a new consumable request
 * Coordinators/Admins can create requests on behalf of employees using 'requested_for' parameter
 */
router.post('/',
  asyncHandler(async (req, res) => {
    const { consumable_id, for_asset_id, quantity_requested, purpose, priority, requested_for } = req.body;

    if (!consumable_id || !quantity_requested || quantity_requested <= 0) {
      return sendError(res, 'Consumable and valid quantity are required', 400);
    }

    const pool = await connectDB();
    const currentUserId = req.user.id;
    const userRole = req.user.role;
    const canRequestOnBehalf = ['coordinator', 'admin', 'superadmin', 'engineer'].includes(userRole);

    // Determine who the request is for
    let requestedById = currentUserId;

    // Coordinators/Admins/Engineers can request on behalf of others
    if (requested_for && canRequestOnBehalf) {
      // Verify the target user exists and is eligible (employee, department_head, department_coordinator, it_head, engineer)
      const targetUser = await pool.request()
        .input('user_id', sql.UniqueIdentifier, requested_for)
        .query(`
          SELECT user_id, role FROM USER_MASTER
          WHERE user_id = @user_id AND is_active = 1
          AND role IN ('employee', 'department_head', 'department_coordinator', 'it_head', 'engineer')
        `);

      if (targetUser.recordset.length === 0) {
        return sendError(res, 'Target user not found or not eligible for consumable requests', 400);
      }

      requestedById = requested_for;
    } else if (!canRequestOnBehalf) {
      // Regular users can only request for themselves
      // Verify current user is eligible (employee, department_head, department_coordinator, it_head, engineer)
      if (!['employee', 'department_head', 'department_coordinator', 'it_head', 'engineer'].includes(userRole)) {
        return sendError(res, 'Only employees, department heads, department coordinators, IT heads, and engineers can request consumables', 403);
      }
    }

    // Verify consumable exists and is active
    const consumable = await pool.request()
      .input('id', sql.UniqueIdentifier, consumable_id)
      .query('SELECT id, name FROM consumables WHERE id = @id AND is_active = 1');

    if (consumable.recordset.length === 0) {
      return sendError(res, 'Consumable not found or inactive', 404);
    }

    // If for_asset_id provided, verify the consumable is compatible AND asset belongs to the requester
    if (for_asset_id) {
      const assetCheck = await pool.request()
        .input('asset_id', sql.UniqueIdentifier, for_asset_id)
        .input('user_id', sql.UniqueIdentifier, requestedById)
        .query(`
          SELECT id FROM assets
          WHERE id = @asset_id AND assigned_to = @user_id AND is_active = 1
        `);

      if (assetCheck.recordset.length === 0) {
        return sendError(res, 'Asset not found or not assigned to the requester', 400);
      }

      const compatible = await pool.request()
        .input('consumable_id', sql.UniqueIdentifier, consumable_id)
        .input('asset_id', sql.UniqueIdentifier, for_asset_id)
        .query(`
          SELECT cp.id FROM consumable_compatibility cp
          JOIN assets a ON a.product_id = cp.product_id
          WHERE cp.consumable_id = @consumable_id AND a.id = @asset_id
        `);

      if (compatible.recordset.length === 0) {
        return sendError(res, 'This consumable is not compatible with the selected asset', 400);
      }
    }

    const requestNumber = await generateRequestNumber(pool);
    const newId = uuidv4();

    await pool.request()
      .input('id', sql.UniqueIdentifier, newId)
      .input('request_number', sql.VarChar(50), requestNumber)
      .input('requested_by', sql.UniqueIdentifier, requestedById)
      .input('created_by', sql.UniqueIdentifier, currentUserId)
      .input('for_asset_id', sql.UniqueIdentifier, for_asset_id || null)
      .input('consumable_id', sql.UniqueIdentifier, consumable_id)
      .input('quantity_requested', sql.Int, quantity_requested)
      .input('purpose', sql.VarChar(500), purpose || null)
      .input('priority', sql.VarChar(20), priority || 'normal')
      .query(`
        INSERT INTO consumable_requests
        (id, request_number, requested_by, created_by, for_asset_id, consumable_id, quantity_requested, purpose, priority)
        VALUES (@id, @request_number, @requested_by, @created_by, @for_asset_id, @consumable_id, @quantity_requested, @purpose, @priority)
      `);

    // Get requester name for notifications
    const requesterResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, requestedById)
      .query(`SELECT first_name + ' ' + last_name as name, email FROM USER_MASTER WHERE user_id = @userId`);
    const requesterName = requesterResult.recordset[0]?.name || 'Unknown';

    // Send notifications to coordinators and admins
    try {
      // Get all coordinators and admins
      const approversResult = await pool.request()
        .query(`
          SELECT user_id, first_name + ' ' + last_name as name, email
          FROM USER_MASTER
          WHERE role IN ('coordinator', 'admin', 'superadmin') AND is_active = 1
        `);

      const approvers = approversResult.recordset;

      // Create in-app notifications for approvers
      for (const approver of approvers) {
        try {
          await NotificationModel.createNotification({
            user_id: approver.user_id,
            ticket_id: null,
            notification_type: 'consumable_request',
            title: `New Consumable Request: ${requestNumber}`,
            message: `${requesterName} has requested ${quantity_requested} x ${consumable.recordset[0].name}. Priority: ${priority || 'normal'}`,
            priority: priority === 'urgent' ? 'high' : 'medium',
            related_data: {
              request_id: newId,
              request_number: requestNumber,
              consumable_name: consumable.recordset[0].name,
              quantity: quantity_requested,
              requester_name: requesterName,
              priority: priority || 'normal'
            }
          });
        } catch (notifError) {
          console.error('Failed to create in-app notification for approver:', notifError.message);
        }
      }

      // Send email notifications to approvers
      for (const approver of approvers) {
        if (approver.email) {
          try {
            const emailSubject = `New Consumable Request: ${requestNumber}`;
            const emailBody = `
Hello ${approver.name},

A new consumable request has been submitted and requires your attention.

Request Details:
- Request Number: ${requestNumber}
- Consumable: ${consumable.recordset[0].name}
- Quantity: ${quantity_requested}
- Requested By: ${requesterName}
- Priority: ${(priority || 'normal').toUpperCase()}
${purpose ? `- Purpose: ${purpose}` : ''}

Please log in to the Unified ITSM Platform to review and approve/reject this request.

This is an automated notification. Please do not reply to this email.
            `;

            await emailService.sendEmail(approver.email, emailSubject, emailBody.trim());
          } catch (emailError) {
            console.error('Failed to send email notification to approver:', emailError.message);
          }
        }
      }
    } catch (notificationError) {
      console.error('Failed to send notifications for consumable request:', notificationError.message);
    }

    sendCreated(res, {
      id: newId,
      request_number: requestNumber,
      consumable_name: consumable.recordset[0].name,
      requested_for: requestedById !== currentUserId ? requestedById : null
    }, 'Request created successfully');
  })
);

/**
 * PUT /consumables/requests/:id/approve
 * Approve a consumable request
 * - Validates sufficient stock at requester's location (or any location)
 * - Requires engineer assignment for delivery
 * - Auto-deducts stock from inventory
 * - Records transaction in consumable_transactions
 */
router.put('/:id/approve',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { notes, assigned_engineer, location_id } = req.body;
    const userId = req.user.id;

    // Validate engineer assignment
    if (!assigned_engineer) {
      return sendError(res, 'Engineer assignment is required for approval', 400);
    }

    const pool = await connectDB();

    // Check request exists and is pending, get full details
    const request = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT cr.*, c.name as consumable_name,
               req.location_id as requester_location_id,
               req_loc.name as requester_location_name
        FROM consumable_requests cr
        JOIN consumables c ON cr.consumable_id = c.id
        JOIN USER_MASTER req ON cr.requested_by = req.user_id
        LEFT JOIN locations req_loc ON req.location_id = req_loc.id
        WHERE cr.id = @id
      `);

    if (request.recordset.length === 0) {
      return sendNotFound(res, 'Request not found');
    }

    const reqData = request.recordset[0];

    if (reqData.status !== 'pending') {
      return sendError(res, 'Request is not in pending status', 400);
    }

    // Validate assigned engineer exists and is an engineer role
    const engineerCheck = await pool.request()
      .input('engineer_id', sql.UniqueIdentifier, assigned_engineer)
      .query(`
        SELECT user_id, first_name, last_name FROM USER_MASTER
        WHERE user_id = @engineer_id AND is_active = 1 AND role = 'engineer'
      `);

    if (engineerCheck.recordset.length === 0) {
      return sendError(res, 'Invalid engineer selected or user is not an engineer', 400);
    }

    // Determine source location for stock - prefer specified location, then requester's location, then any available
    const sourceLocationId = location_id || reqData.requester_location_id || null;

    // Check stock availability at the determined location
    const stockCheck = await pool.request()
      .input('consumable_id', sql.UniqueIdentifier, reqData.consumable_id)
      .input('location_id', sql.UniqueIdentifier, sourceLocationId)
      .query(`
        SELECT id, quantity_in_stock, COALESCE(quantity_reserved, 0) as quantity_reserved, location_id
        FROM consumable_inventory
        WHERE consumable_id = @consumable_id
          AND (
            (@location_id IS NOT NULL AND location_id = @location_id) OR
            (@location_id IS NULL)
          )
        ORDER BY quantity_in_stock DESC
      `);

    if (stockCheck.recordset.length === 0) {
      return sendError(res, 'No inventory record found for this consumable', 400);
    }

    const stockRecord = stockCheck.recordset[0];
    const availableStock = stockRecord.quantity_in_stock - stockRecord.quantity_reserved;

    if (availableStock < reqData.quantity_requested) {
      return sendError(res, `Insufficient stock. Available: ${availableStock}, Requested: ${reqData.quantity_requested}`, 400);
    }

    // Begin transaction for approval + stock deduction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const quantityBefore = stockRecord.quantity_in_stock;
      const quantityAfter = quantityBefore - reqData.quantity_requested;

      // Deduct stock from inventory
      const updateStockReq = new sql.Request(transaction);
      await updateStockReq
        .input('inventory_id', sql.UniqueIdentifier, stockRecord.id)
        .input('quantity', sql.Int, reqData.quantity_requested)
        .query(`
          UPDATE consumable_inventory
          SET quantity_in_stock = quantity_in_stock - @quantity,
              updated_at = GETUTCDATE()
          WHERE id = @inventory_id
        `);

      // Update request status with engineer assignment
      const updateRequestReq = new sql.Request(transaction);
      await updateRequestReq
        .input('id', sql.UniqueIdentifier, id)
        .input('approved_by', sql.UniqueIdentifier, userId)
        .input('assigned_engineer', sql.UniqueIdentifier, assigned_engineer)
        .input('quantity_issued', sql.Int, reqData.quantity_requested)
        .input('notes', sql.VarChar(500), notes || null)
        .query(`
          UPDATE consumable_requests
          SET status = 'approved',
              approved_by = @approved_by,
              approved_at = GETUTCDATE(),
              assigned_engineer = @assigned_engineer,
              assigned_at = GETUTCDATE(),
              quantity_issued = @quantity_issued,
              notes = COALESCE(@notes, notes),
              updated_at = GETUTCDATE()
          WHERE id = @id
        `);

      // Log transaction in consumable_transactions
      const logTxnReq = new sql.Request(transaction);
      await logTxnReq
        .input('txn_id', sql.UniqueIdentifier, uuidv4())
        .input('consumable_id', sql.UniqueIdentifier, reqData.consumable_id)
        .input('location_id', sql.UniqueIdentifier, stockRecord.location_id)
        .input('quantity', sql.Int, reqData.quantity_requested)
        .input('quantity_before', sql.Int, quantityBefore)
        .input('quantity_after', sql.Int, quantityAfter)
        .input('reference_id', sql.UniqueIdentifier, id)
        .input('notes', sql.NVarChar(500), `Issued for request ${reqData.request_number}`)
        .input('performed_by', sql.UniqueIdentifier, userId)
        .query(`
          INSERT INTO consumable_transactions
          (id, consumable_id, location_id, transaction_type, quantity, quantity_before, quantity_after, reference_type, reference_id, notes, performed_by)
          VALUES (@txn_id, @consumable_id, @location_id, 'request_fulfillment', @quantity, @quantity_before, @quantity_after, 'consumable_request', @reference_id, @notes, @performed_by)
        `);

      await transaction.commit();

      // Send notifications to requester and assigned engineer
      try {
        // Get requester info
        const requesterResult = await pool.request()
          .input('userId', sql.UniqueIdentifier, reqData.requested_by)
          .query(`SELECT user_id, first_name + ' ' + last_name as name, email FROM USER_MASTER WHERE user_id = @userId`);
        const requester = requesterResult.recordset[0];
        const engineerName = `${engineerCheck.recordset[0].first_name} ${engineerCheck.recordset[0].last_name}`;
        const engineerEmail = engineerCheck.recordset[0].email;

        // In-app notification to requester
        if (requester) {
          try {
            await NotificationModel.createNotification({
              user_id: requester.user_id,
              ticket_id: null,
              notification_type: 'consumable_approved',
              title: `Request Approved: ${reqData.request_number}`,
              message: `Your consumable request for ${reqData.quantity_requested} x ${reqData.consumable_name} has been approved. Engineer ${engineerName} will deliver it soon.`,
              priority: 'medium',
              related_data: {
                request_id: id,
                request_number: reqData.request_number,
                consumable_name: reqData.consumable_name,
                quantity: reqData.quantity_requested,
                assigned_engineer: engineerName
              }
            });
          } catch (notifError) {
            console.error('Failed to create in-app notification for requester:', notifError.message);
          }

          // Email notification to requester
          if (requester.email) {
            try {
              const emailSubject = `Consumable Request Approved: ${reqData.request_number}`;
              const emailBody = `
Hello ${requester.name},

Great news! Your consumable request has been approved.

Request Details:
- Request Number: ${reqData.request_number}
- Consumable: ${reqData.consumable_name}
- Quantity: ${reqData.quantity_requested}
- Assigned Engineer: ${engineerName}

The engineer will contact you to arrange delivery.

This is an automated notification. Please do not reply to this email.
              `;
              await emailService.sendEmail(requester.email, emailSubject, emailBody.trim());
            } catch (emailError) {
              console.error('Failed to send email to requester:', emailError.message);
            }
          }
        }

        // In-app notification to assigned engineer
        try {
          await NotificationModel.createNotification({
            user_id: assigned_engineer,
            ticket_id: null,
            notification_type: 'consumable_delivery_assigned',
            title: `Delivery Assignment: ${reqData.request_number}`,
            message: `You have been assigned to deliver ${reqData.quantity_requested} x ${reqData.consumable_name} to ${requester?.name || 'the requester'}.`,
            priority: 'high',
            related_data: {
              request_id: id,
              request_number: reqData.request_number,
              consumable_name: reqData.consumable_name,
              quantity: reqData.quantity_requested,
              requester_name: requester?.name,
              requester_location: reqData.requester_location_name
            }
          });
        } catch (notifError) {
          console.error('Failed to create in-app notification for engineer:', notifError.message);
        }

        // Email notification to assigned engineer
        if (engineerEmail) {
          try {
            const emailSubject = `Consumable Delivery Assignment: ${reqData.request_number}`;
            const emailBody = `
Hello ${engineerName},

You have been assigned a consumable delivery task.

Delivery Details:
- Request Number: ${reqData.request_number}
- Consumable: ${reqData.consumable_name}
- Quantity: ${reqData.quantity_requested}
- Deliver To: ${requester?.name || 'Unknown'}
${reqData.requester_location_name ? `- Location: ${reqData.requester_location_name}` : ''}

Please complete the delivery and mark it as delivered in the system.

This is an automated notification. Please do not reply to this email.
            `;
            await emailService.sendEmail(engineerEmail, emailSubject, emailBody.trim());
          } catch (emailError) {
            console.error('Failed to send email to engineer:', emailError.message);
          }
        }
      } catch (notificationError) {
        console.error('Failed to send approval notifications:', notificationError.message);
      }

      sendSuccess(res, {
        assigned_engineer: assigned_engineer,
        engineer_name: `${engineerCheck.recordset[0].first_name} ${engineerCheck.recordset[0].last_name}`,
        quantity_issued: reqData.quantity_requested,
        stock_after: quantityAfter
      }, 'Request approved and stock deducted successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * PUT /consumables/requests/:id/reject
 * Reject a consumable request
 */
router.put('/:id/reject',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const userId = req.user.id;

    if (!rejection_reason) {
      return sendError(res, 'Rejection reason is required', 400);
    }

    const pool = await connectDB();

    // Get request details including requester info
    const request = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT cr.id, cr.status, cr.request_number, cr.requested_by, cr.quantity_requested,
               c.name as consumable_name,
               u.first_name + ' ' + u.last_name as requester_name, u.email as requester_email
        FROM consumable_requests cr
        JOIN consumables c ON cr.consumable_id = c.id
        JOIN USER_MASTER u ON cr.requested_by = u.user_id
        WHERE cr.id = @id
      `);

    if (request.recordset.length === 0) {
      return sendNotFound(res, 'Request not found');
    }

    const reqData = request.recordset[0];

    if (reqData.status !== 'pending') {
      return sendError(res, 'Request is not in pending status', 400);
    }

    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('approved_by', sql.UniqueIdentifier, userId)
      .input('rejection_reason', sql.VarChar(500), rejection_reason)
      .query(`
        UPDATE consumable_requests
        SET status = 'rejected',
            approved_by = @approved_by,
            approved_at = GETUTCDATE(),
            rejection_reason = @rejection_reason,
            updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    // Send notification to requester
    try {
      // In-app notification
      await NotificationModel.createNotification({
        user_id: reqData.requested_by,
        ticket_id: null,
        notification_type: 'consumable_rejected',
        title: `Request Rejected: ${reqData.request_number}`,
        message: `Your consumable request for ${reqData.quantity_requested} x ${reqData.consumable_name} has been rejected. Reason: ${rejection_reason}`,
        priority: 'medium',
        related_data: {
          request_id: id,
          request_number: reqData.request_number,
          consumable_name: reqData.consumable_name,
          quantity: reqData.quantity_requested,
          rejection_reason: rejection_reason
        }
      });

      // Email notification
      if (reqData.requester_email) {
        const emailSubject = `Consumable Request Rejected: ${reqData.request_number}`;
        const emailBody = `
Hello ${reqData.requester_name},

Unfortunately, your consumable request has been rejected.

Request Details:
- Request Number: ${reqData.request_number}
- Consumable: ${reqData.consumable_name}
- Quantity Requested: ${reqData.quantity_requested}

Rejection Reason: ${rejection_reason}

If you believe this was a mistake or have questions, please contact your coordinator.

This is an automated notification. Please do not reply to this email.
        `;
        await emailService.sendEmail(reqData.requester_email, emailSubject, emailBody.trim());
      }
    } catch (notificationError) {
      console.error('Failed to send rejection notification:', notificationError.message);
    }

    sendSuccess(res, null, 'Request rejected');
  })
);

/**
 * PUT /consumables/requests/:id/deliver
 * Mark request as delivered by the assigned engineer
 * - Only assigned engineer or admin can mark as delivered
 * - Works from 'approved' status (issue step removed)
 */
router.put('/:id/deliver',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { delivery_notes } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const pool = await connectDB();

    // Get request details including requester info
    const request = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT cr.id, cr.status, cr.requested_by, cr.assigned_engineer, cr.request_number, cr.quantity_requested,
               c.name as consumable_name,
               u.first_name + ' ' + u.last_name as requester_name, u.email as requester_email,
               eng.first_name + ' ' + eng.last_name as engineer_name
        FROM consumable_requests cr
        JOIN consumables c ON cr.consumable_id = c.id
        JOIN USER_MASTER u ON cr.requested_by = u.user_id
        LEFT JOIN USER_MASTER eng ON cr.assigned_engineer = eng.user_id
        WHERE cr.id = @id
      `);

    if (request.recordset.length === 0) {
      return sendNotFound(res, 'Request not found');
    }

    const reqData = request.recordset[0];

    // Must be in approved status
    if (reqData.status !== 'approved') {
      return sendError(res, 'Request must be approved before delivery', 400);
    }

    // Only assigned engineer or admin/coordinator can mark as delivered
    const isAssignedEngineer = reqData.assigned_engineer === userId;
    const isAdmin = ['admin', 'superadmin', 'coordinator'].includes(userRole);

    if (!isAssignedEngineer && !isAdmin) {
      return sendError(res, 'Only the assigned engineer or admin can mark this as delivered', 403);
    }

    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('received_by', sql.UniqueIdentifier, userId)
      .input('notes', sql.VarChar(500), delivery_notes || null)
      .query(`
        UPDATE consumable_requests
        SET status = 'delivered',
            delivered_at = GETUTCDATE(),
            received_by = @received_by,
            notes = CASE WHEN @notes IS NOT NULL THEN COALESCE(notes + '. ', '') + @notes ELSE notes END,
            updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    // Send notification to requester
    try {
      // In-app notification
      await NotificationModel.createNotification({
        user_id: reqData.requested_by,
        ticket_id: null,
        notification_type: 'consumable_delivered',
        title: `Consumable Delivered: ${reqData.request_number}`,
        message: `Your consumable request for ${reqData.quantity_requested} x ${reqData.consumable_name} has been delivered by ${reqData.engineer_name || 'the engineer'}.`,
        priority: 'low',
        related_data: {
          request_id: id,
          request_number: reqData.request_number,
          consumable_name: reqData.consumable_name,
          quantity: reqData.quantity_requested,
          delivered_by: reqData.engineer_name
        }
      });

      // Email notification
      if (reqData.requester_email) {
        const emailSubject = `Consumable Delivered: ${reqData.request_number}`;
        const emailBody = `
Hello ${reqData.requester_name},

Your consumable request has been delivered!

Delivery Details:
- Request Number: ${reqData.request_number}
- Consumable: ${reqData.consumable_name}
- Quantity: ${reqData.quantity_requested}
- Delivered By: ${reqData.engineer_name || 'Engineer'}
${delivery_notes ? `- Notes: ${delivery_notes}` : ''}

If you have any issues with the delivery, please create a new ticket.

This is an automated notification. Please do not reply to this email.
        `;
        await emailService.sendEmail(reqData.requester_email, emailSubject, emailBody.trim());
      }
    } catch (notificationError) {
      console.error('Failed to send delivery notification:', notificationError.message);
    }

    sendSuccess(res, { request_number: reqData.request_number }, 'Delivery confirmed successfully');
  })
);

/**
 * PUT /consumables/requests/:id/cancel
 * Cancel a pending request
 */
router.put('/:id/cancel',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const pool = await connectDB();

    const request = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, status, requested_by FROM consumable_requests WHERE id = @id');

    if (request.recordset.length === 0) {
      return sendNotFound(res, 'Request not found');
    }

    // Only requestor or admin can cancel, and only if pending
    const userRole = req.user.role;
    if (request.recordset[0].requested_by !== userId && !['admin', 'superadmin'].includes(userRole)) {
      return sendError(res, 'You can only cancel your own requests', 403);
    }

    if (!['pending', 'approved'].includes(request.recordset[0].status)) {
      return sendError(res, 'Only pending or approved requests can be cancelled', 400);
    }

    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE consumable_requests
        SET status = 'cancelled', updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Request cancelled');
  })
);

module.exports = router;
