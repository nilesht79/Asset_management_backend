const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { connectDB, sql } = require('../../config/database');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { validatePagination } = require('../../middleware/validation');
const {
  generateRequisitionNumber,
  isValidStatusTransition,
  getDepartmentHead,
  getITHead,
  logApprovalHistory,
  REQUISITION_STATUS
} = require('../../utils/requisition-helpers');

const router = express.Router();
const approvalsRouter = require('./approvals');
const assignmentsRouter = require('./assignments');

// Apply authentication to all routes
router.use(authenticateToken);

// Mount approval routes (must be before other routes to avoid conflicts)
router.use('/', approvalsRouter);

// Mount assignment routes
router.use('/', assignmentsRouter);

// ==================== EMPLOYEE ROUTES ====================

// POST /api/v1/requisitions - Create new requisition
router.post('/',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const {
      asset_category_id,
      product_type_id,
      requested_product_id,
      quantity = 1,
      purpose,
      justification,
      urgency,
      required_by_date,
      specifications
    } = req.body;

    const userId = req.oauth.user.id;
    const pool = await connectDB();

    // Get user details
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`
        SELECT user_id, first_name, last_name, email, department_id, role
        FROM USER_MASTER
        WHERE user_id = @userId
      `);

    if (userResult.recordset.length === 0) {
      return sendError(res, 'User not found', 404);
    }

    const user = userResult.recordset[0];

    if (!user.department_id) {
      return sendError(res, 'User must be assigned to a department to create requisitions', 400);
    }

    // Get department details
    const deptResult = await pool.request()
      .input('deptId', sql.UniqueIdentifier, user.department_id)
      .query(`
        SELECT department_id, department_name
        FROM DEPARTMENT_MASTER
        WHERE department_id = @deptId
      `);

    if (deptResult.recordset.length === 0) {
      return sendError(res, 'Department not found', 404);
    }

    const department = deptResult.recordset[0];

    // Get department head
    const deptHead = await getDepartmentHead(user.department_id);

    // Generate requisition number
    const requisitionNumber = await generateRequisitionNumber();
    const requisitionId = uuidv4();

    // Create requisition
    await pool.request()
      .input('requisitionId', sql.UniqueIdentifier, requisitionId)
      .input('requisitionNumber', sql.VarChar(50), requisitionNumber)
      .input('requestedBy', sql.UniqueIdentifier, userId)
      .input('requesterName', sql.NVarChar(200), `${user.first_name} ${user.last_name}`)
      .input('departmentId', sql.UniqueIdentifier, user.department_id)
      .input('departmentName', sql.NVarChar(200), department.department_name)
      .input('assetCategoryId', sql.UniqueIdentifier, asset_category_id || null)
      .input('productTypeId', sql.UniqueIdentifier, product_type_id || null)
      .input('requestedProductId', sql.UniqueIdentifier, requested_product_id || null)
      .input('quantity', sql.Int, quantity)
      .input('purpose', sql.NVarChar(500), purpose)
      .input('justification', sql.NVarChar(1000), justification)
      .input('urgency', sql.VarChar(20), urgency)
      .input('requiredByDate', sql.Date, required_by_date || null)
      .input('specifications', sql.Text, specifications || null)
      .input('deptHeadId', sql.UniqueIdentifier, deptHead ? deptHead.user_id : null)
      .input('deptHeadName', sql.NVarChar(200), deptHead ? `${deptHead.first_name} ${deptHead.last_name}` : null)
      .query(`
        INSERT INTO ASSET_REQUISITIONS (
          requisition_id, requisition_number, requested_by, requester_name,
          department_id, department_name, asset_category_id, product_type_id,
          requested_product_id, quantity, purpose, justification, urgency,
          required_by_date, specifications, status, dept_head_id, dept_head_name
        ) VALUES (
          @requisitionId, @requisitionNumber, @requestedBy, @requesterName,
          @departmentId, @departmentName, @assetCategoryId, @productTypeId,
          @requestedProductId, @quantity, @purpose, @justification, @urgency,
          @requiredByDate, @specifications, 'pending_dept_head', @deptHeadId, @deptHeadName
        )
      `);

    // Log creation in approval history
    await logApprovalHistory({
      requisition_id: requisitionId,
      approval_level: 'employee',
      approver_id: userId,
      approver_name: `${user.first_name} ${user.last_name}`,
      approver_role: user.role,
      action: 'created',
      comments: 'Requisition created',
      previous_status: null,
      new_status: 'pending_dept_head'
    });

    // Get created requisition
    const result = await pool.request()
      .input('requisitionId', sql.UniqueIdentifier, requisitionId)
      .query(`
        SELECT * FROM ASSET_REQUISITIONS WHERE requisition_id = @requisitionId
      `);

    sendCreated(res, result.recordset[0], 'Requisition created successfully');
  })
);

// GET /api/v1/requisitions/all-requisitions - Get all requisitions (for coordinators, dept heads, IT heads)
router.get('/all-requisitions',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { status, urgency, search, department_id, requester_id } = req.query;
    const userId = req.oauth.user.id;
    const userRole = req.oauth.user.role;

    const pool = await connectDB();

    // Build WHERE clause based on role
    let whereClause = '1=1'; // Start with always true condition
    const params = [];

    // Role-based filtering
    if (userRole === 'department_head') {
      // Department heads see only their department's requisitions
      const userDept = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query('SELECT department_id FROM USER_MASTER WHERE user_id = @userId');

      if (userDept.recordset.length > 0 && userDept.recordset[0].department_id) {
        whereClause += ' AND department_id = @userDepartmentId';
        params.push({ name: 'userDepartmentId', type: sql.UniqueIdentifier, value: userDept.recordset[0].department_id });
      }
    }
    // Coordinators and IT heads see all requisitions (no additional filtering)

    // Additional filters
    if (status) {
      whereClause += ' AND status = @status';
      params.push({ name: 'status', type: sql.VarChar(50), value: status });
    }

    if (urgency) {
      whereClause += ' AND urgency = @urgency';
      params.push({ name: 'urgency', type: sql.VarChar(20), value: urgency });
    }

    if (department_id) {
      whereClause += ' AND department_id = @departmentId';
      params.push({ name: 'departmentId', type: sql.UniqueIdentifier, value: department_id });
    }

    if (requester_id) {
      whereClause += ' AND requested_by = @requesterId';
      params.push({ name: 'requesterId', type: sql.UniqueIdentifier, value: requester_id });
    }

    if (search) {
      whereClause += ' AND (requisition_number LIKE @search OR purpose LIKE @search OR requester_name LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(p => countRequest.input(p.name, p.type, p.value));
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total FROM ASSET_REQUISITIONS WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(p => dataRequest.input(p.name, p.type, p.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const result = await dataRequest.query(`
      SELECT * FROM ASSET_REQUISITIONS
      WHERE ${whereClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      requisitions: result.recordset,
      pagination
    }, 'Requisitions retrieved successfully');
  })
);

// GET /api/v1/requisitions/my-requisitions - Get employee's requisitions
router.get('/my-requisitions',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { status, urgency, search } = req.query;
    const userId = req.oauth.user.id;

    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = 'requested_by = @userId';
    const params = [{ name: 'userId', type: sql.UniqueIdentifier, value: userId }];

    if (status) {
      whereClause += ' AND status = @status';
      params.push({ name: 'status', type: sql.VarChar(50), value: status });
    }

    if (urgency) {
      whereClause += ' AND urgency = @urgency';
      params.push({ name: 'urgency', type: sql.VarChar(20), value: urgency });
    }

    if (search) {
      whereClause += ' AND (requisition_number LIKE @search OR purpose LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(p => countRequest.input(p.name, p.type, p.value));
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total FROM ASSET_REQUISITIONS WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(p => dataRequest.input(p.name, p.type, p.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const result = await dataRequest.query(`
      SELECT * FROM ASSET_REQUISITIONS
      WHERE ${whereClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      requisitions: result.recordset,
      pagination
    }, 'Requisitions retrieved successfully');
  })
);

// GET /api/v1/requisitions/:id - Get requisition details
router.get('/:id',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT r.*,
               cat.name as category_name,
               pt.name as product_type_name,
               p.name as product_name, p.model as product_model
        FROM ASSET_REQUISITIONS r
        LEFT JOIN categories cat ON r.asset_category_id = cat.id
        LEFT JOIN product_types pt ON r.product_type_id = pt.id
        LEFT JOIN products p ON r.requested_product_id = p.id
        WHERE r.requisition_id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Requisition not found');
    }

    // Get approval history
    const historyResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT * FROM REQUISITION_APPROVAL_HISTORY
        WHERE requisition_id = @id
        ORDER BY action_timestamp ASC
      `);

    const requisition = result.recordset[0];
    requisition.approval_history = historyResult.recordset;

    sendSuccess(res, requisition, 'Requisition retrieved successfully');
  })
);

// PUT /api/v1/requisitions/:id/cancel - Cancel requisition
router.put('/:id/cancel',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { cancellation_reason } = req.body;
    const userId = req.oauth.user.id;
    const pool = await connectDB();

    // Get requisition
    const reqResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`SELECT * FROM ASSET_REQUISITIONS WHERE requisition_id = @id`);

    if (reqResult.recordset.length === 0) {
      return sendNotFound(res, 'Requisition not found');
    }

    const requisition = reqResult.recordset[0];

    // Verify user is the requester
    if (requisition.requested_by !== userId) {
      return sendError(res, 'You can only cancel your own requisitions', 403);
    }

    // Check if can be cancelled
    if (!isValidStatusTransition(requisition.status, 'cancelled')) {
      return sendError(res, `Cannot cancel requisition with status: ${requisition.status}`, 400);
    }

    // Update requisition
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('reason', sql.Text, cancellation_reason)
      .query(`
        UPDATE ASSET_REQUISITIONS
        SET status = 'cancelled',
            cancellation_reason = @reason,
            cancelled_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
        WHERE requisition_id = @id
      `);

    // Log in history
    const user = req.oauth.user;
    await logApprovalHistory({
      requisition_id: id,
      approval_level: 'employee',
      approver_id: userId,
      approver_name: `${user.first_name} ${user.last_name}`,
      approver_role: user.role,
      action: 'cancelled',
      comments: cancellation_reason,
      previous_status: requisition.status,
      new_status: 'cancelled'
    });

    sendSuccess(res, null, 'Requisition cancelled successfully');
  })
);

module.exports = router;
