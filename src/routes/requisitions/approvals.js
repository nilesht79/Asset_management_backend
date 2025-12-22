const express = require('express');
const { connectDB, sql } = require('../../config/database');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendNotFound } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { validatePagination } = require('../../middleware/validation');
const {
  isValidStatusTransition,
  getITHead,
  logApprovalHistory
} = require('../../utils/requisition-helpers');
const requisitionNotificationService = require('../../services/requisitionNotificationService');

const router = express.Router();

router.use(authenticateToken);

// ==================== DEPARTMENT HEAD ROUTES ====================

// GET /api/v1/requisitions/pending-dept-approvals
router.get('/pending-dept-approvals',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { urgency, search } = req.query;
    const userId = req.oauth.user.id;
    const pool = await connectDB();

    // Get user's department
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`SELECT department_id FROM USER_MASTER WHERE user_id = @userId`);

    if (userResult.recordset.length === 0 || !userResult.recordset[0].department_id) {
      return sendError(res, 'User not assigned to a department', 400);
    }

    const departmentId = userResult.recordset[0].department_id;

    // Build WHERE clause
    let whereClause = 'department_id = @deptId AND status = \'pending_dept_head\'';
    const params = [{ name: 'deptId', type: sql.UniqueIdentifier, value: departmentId }];

    if (urgency) {
      whereClause += ' AND urgency = @urgency';
      params.push({ name: 'urgency', type: sql.VarChar(20), value: urgency });
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
      SELECT r.*,
             cat.name as category_name,
             pt.name as product_type_name
      FROM ASSET_REQUISITIONS r
      LEFT JOIN categories cat ON r.asset_category_id = cat.id
      LEFT JOIN product_types pt ON r.product_type_id = pt.id
      WHERE ${whereClause}
      ORDER BY
        CASE urgency
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        created_at ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      requisitions: result.recordset,
      pagination
    }, 'Pending approvals retrieved successfully');
  })
);

// PUT /api/v1/requisitions/:id/dept-head-approve
router.put('/:id/dept-head-approve',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.oauth.user.id;
    const user = req.oauth.user;
    const pool = await connectDB();

    // Get requisition
    const reqResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`SELECT * FROM ASSET_REQUISITIONS WHERE requisition_id = @id`);

    if (reqResult.recordset.length === 0) {
      return sendNotFound(res, 'Requisition not found');
    }

    const requisition = reqResult.recordset[0];

    // Verify status
    if (requisition.status !== 'pending_dept_head') {
      return sendError(res, `Cannot approve requisition with status: ${requisition.status}`, 400);
    }

    // Verify user is department head of requisition's department
    const userDeptResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`SELECT department_id FROM USER_MASTER WHERE user_id = @userId`);

    if (userDeptResult.recordset.length === 0) {
      return sendError(res, 'User not found', 404);
    }

    if (userDeptResult.recordset[0].department_id !== requisition.department_id) {
      return sendError(res, 'You can only approve requisitions from your department', 403);
    }

    // Get IT head for next approval
    const itHead = await getITHead();

    // Update requisition
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('deptHeadId', sql.UniqueIdentifier, userId)
      .input('deptHeadName', sql.NVarChar(200), `${user.firstName} ${user.lastName}`)
      .input('comments', sql.Text, comments || null)
      .input('itHeadId', sql.UniqueIdentifier, itHead ? itHead.user_id : null)
      .input('itHeadName', sql.NVarChar(200), itHead ? `${itHead.firstName} ${itHead.lastName}` : null)
      .query(`
        UPDATE ASSET_REQUISITIONS
        SET status = 'approved_by_dept_head',
            dept_head_id = @deptHeadId,
            dept_head_name = @deptHeadName,
            dept_head_status = 'approved',
            dept_head_comments = @comments,
            dept_head_approved_at = GETUTCDATE(),
            it_head_id = @itHeadId,
            it_head_name = @itHeadName,
            updated_at = GETUTCDATE()
        WHERE requisition_id = @id
      `);

    // Move to next status (pending IT head)
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE ASSET_REQUISITIONS
        SET status = 'pending_it_head'
        WHERE requisition_id = @id
      `);

    // Log approval
    await logApprovalHistory({
      requisition_id: id,
      approval_level: 'dept_head',
      approver_id: userId,
      approver_name: `${user.firstName} ${user.lastName}`,
      approver_role: user.role,
      action: 'approved',
      comments: comments,
      previous_status: 'pending_dept_head',
      new_status: 'pending_it_head'
    });

    // Check if requester is IT Head - auto-approve at IT level
    const requesterResult = await pool.request()
      .input('requestedBy', sql.UniqueIdentifier, requisition.requested_by)
      .query(`SELECT user_id, role, first_name, last_name FROM USER_MASTER WHERE user_id = @requestedBy`);

    const requester = requesterResult.recordset[0];
    const isRequesterITHead = requester && requester.role === 'it_head';

    if (isRequesterITHead) {
      // Auto-approve at IT level since requester is IT Head
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('itHeadId', sql.UniqueIdentifier, requisition.requested_by)
        .input('itHeadName', sql.NVarChar(200), `${requester.first_name} ${requester.last_name}`)
        .query(`
          UPDATE ASSET_REQUISITIONS
          SET status = 'pending_assignment',
              it_head_id = @itHeadId,
              it_head_name = @itHeadName,
              it_head_status = 'approved',
              it_head_comments = 'Auto-approved (requester is IT Head)',
              it_head_approved_at = GETUTCDATE(),
              updated_at = GETUTCDATE()
          WHERE requisition_id = @id
        `);

      // Log IT head auto-approval
      await logApprovalHistory({
        requisition_id: id,
        approval_level: 'it_head',
        approver_id: requisition.requested_by,
        approver_name: `${requester.first_name} ${requester.last_name}`,
        approver_role: 'it_head',
        action: 'approved',
        comments: 'Auto-approved (requester is IT Head)',
        previous_status: 'pending_it_head',
        new_status: 'pending_assignment'
      });

      // Notify coordinators for assignment instead of IT head
      requisitionNotificationService.notifyITHeadApproved(requisition, requester);
    } else {
      // Send notifications to IT Head and Employee
      requisitionNotificationService.notifyDeptHeadApproved(requisition, user);
    }

    sendSuccess(res, null, 'Requisition approved successfully');
  })
);

// PUT /api/v1/requisitions/:id/dept-head-reject
router.put('/:id/dept-head-reject',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.oauth.user.id;
    const user = req.oauth.user;
    const pool = await connectDB();

    if (!comments) {
      return sendError(res, 'Rejection reason is required', 400);
    }

    // Get requisition
    const reqResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`SELECT * FROM ASSET_REQUISITIONS WHERE requisition_id = @id`);

    if (reqResult.recordset.length === 0) {
      return sendNotFound(res, 'Requisition not found');
    }

    const requisition = reqResult.recordset[0];

    // Verify status
    if (requisition.status !== 'pending_dept_head') {
      return sendError(res, `Cannot reject requisition with status: ${requisition.status}`, 400);
    }

    // Verify user is department head
    const userDeptResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`SELECT department_id FROM USER_MASTER WHERE user_id = @userId`);

    if (userDeptResult.recordset.length === 0) {
      return sendError(res, 'User not found', 404);
    }

    if (userDeptResult.recordset[0].department_id !== requisition.department_id) {
      return sendError(res, 'You can only reject requisitions from your department', 403);
    }

    // Update requisition
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('deptHeadId', sql.UniqueIdentifier, userId)
      .input('deptHeadName', sql.NVarChar(200), `${user.firstName} ${user.lastName}`)
      .input('comments', sql.Text, comments)
      .query(`
        UPDATE ASSET_REQUISITIONS
        SET status = 'rejected_by_dept_head',
            dept_head_id = @deptHeadId,
            dept_head_name = @deptHeadName,
            dept_head_status = 'rejected',
            dept_head_comments = @comments,
            dept_head_approved_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
        WHERE requisition_id = @id
      `);

    // Log rejection
    await logApprovalHistory({
      requisition_id: id,
      approval_level: 'dept_head',
      approver_id: userId,
      approver_name: `${user.firstName} ${user.lastName}`,
      approver_role: user.role,
      action: 'rejected',
      comments: comments,
      previous_status: 'pending_dept_head',
      new_status: 'rejected_by_dept_head'
    });

    // Send notification to Employee
    requisitionNotificationService.notifyDeptHeadRejected(requisition, user, comments);

    sendSuccess(res, null, 'Requisition rejected successfully');
  })
);

// ==================== IT HEAD ROUTES ====================

// GET /api/v1/requisitions/pending-it-approvals
router.get('/pending-it-approvals',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { urgency, department_id, search } = req.query;
    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = 'status = \'pending_it_head\'';
    const params = [];

    if (urgency) {
      whereClause += ' AND urgency = @urgency';
      params.push({ name: 'urgency', type: sql.VarChar(20), value: urgency });
    }

    if (department_id) {
      whereClause += ' AND department_id = @deptId';
      params.push({ name: 'deptId', type: sql.UniqueIdentifier, value: department_id });
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
      SELECT r.*,
             cat.name as category_name,
             pt.name as product_type_name
      FROM ASSET_REQUISITIONS r
      LEFT JOIN categories cat ON r.asset_category_id = cat.id
      LEFT JOIN product_types pt ON r.product_type_id = pt.id
      WHERE ${whereClause}
      ORDER BY
        CASE urgency
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        created_at ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      requisitions: result.recordset,
      pagination
    }, 'Pending IT approvals retrieved successfully');
  })
);

// PUT /api/v1/requisitions/:id/it-head-approve
router.put('/:id/it-head-approve',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.oauth.user.id;
    const user = req.oauth.user;
    const pool = await connectDB();

    // Get requisition
    const reqResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`SELECT * FROM ASSET_REQUISITIONS WHERE requisition_id = @id`);

    if (reqResult.recordset.length === 0) {
      return sendNotFound(res, 'Requisition not found');
    }

    const requisition = reqResult.recordset[0];

    // Verify status
    if (requisition.status !== 'pending_it_head') {
      return sendError(res, `Cannot approve requisition with status: ${requisition.status}`, 400);
    }

    // Update requisition
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('itHeadId', sql.UniqueIdentifier, userId)
      .input('itHeadName', sql.NVarChar(200), `${user.firstName} ${user.lastName}`)
      .input('comments', sql.Text, comments || null)
      .query(`
        UPDATE ASSET_REQUISITIONS
        SET status = 'pending_assignment',
            it_head_id = @itHeadId,
            it_head_name = @itHeadName,
            it_head_status = 'approved',
            it_head_comments = @comments,
            it_head_approved_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
        WHERE requisition_id = @id
      `);

    // Log approval
    await logApprovalHistory({
      requisition_id: id,
      approval_level: 'it_head',
      approver_id: userId,
      approver_name: `${user.firstName} ${user.lastName}`,
      approver_role: user.role,
      action: 'approved',
      comments: comments,
      previous_status: 'pending_it_head',
      new_status: 'pending_assignment'
    });

    // Send notifications to Coordinators and Employee
    requisitionNotificationService.notifyITHeadApproved(requisition, user);

    sendSuccess(res, null, 'Requisition approved successfully');
  })
);

// PUT /api/v1/requisitions/:id/it-head-reject
router.put('/:id/it-head-reject',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.oauth.user.id;
    const user = req.oauth.user;
    const pool = await connectDB();

    if (!comments) {
      return sendError(res, 'Rejection reason is required', 400);
    }

    // Get requisition
    const reqResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`SELECT * FROM ASSET_REQUISITIONS WHERE requisition_id = @id`);

    if (reqResult.recordset.length === 0) {
      return sendNotFound(res, 'Requisition not found');
    }

    const requisition = reqResult.recordset[0];

    // Verify status
    if (requisition.status !== 'pending_it_head') {
      return sendError(res, `Cannot reject requisition with status: ${requisition.status}`, 400);
    }

    // Update requisition
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('itHeadId', sql.UniqueIdentifier, userId)
      .input('itHeadName', sql.NVarChar(200), `${user.firstName} ${user.lastName}`)
      .input('comments', sql.Text, comments)
      .query(`
        UPDATE ASSET_REQUISITIONS
        SET status = 'rejected_by_it_head',
            it_head_id = @itHeadId,
            it_head_name = @itHeadName,
            it_head_status = 'rejected',
            it_head_comments = @comments,
            it_head_approved_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
        WHERE requisition_id = @id
      `);

    // Log rejection
    await logApprovalHistory({
      requisition_id: id,
      approval_level: 'it_head',
      approver_id: userId,
      approver_name: `${user.firstName} ${user.lastName}`,
      approver_role: user.role,
      action: 'rejected',
      comments: comments,
      previous_status: 'pending_it_head',
      new_status: 'rejected_by_it_head'
    });

    // Send notifications to Employee and Department Head
    requisitionNotificationService.notifyITHeadRejected(requisition, user, comments);

    sendSuccess(res, null, 'Requisition rejected successfully');
  })
);

module.exports = router;
