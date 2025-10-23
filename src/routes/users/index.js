const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { requireRole, requireSelfOrRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { authenticateToken } = require('../../middleware/auth');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
// const { permissions, USER_ROLES } = require('../../config/auth');
const { roles: USER_ROLES } = require('../../config/auth');
const authConfig = require('../../config/auth');
const validators = require('../../utils/validators');
const { generateUniqueEmail } = require('../../utils/email-generator');
const { generateSecurePassword } = require('../../utils/password-generator');

const router = express.Router();

// Mount bulk upload routes
const bulkUploadRouter = require('./bulk-upload');
router.use('/bulk-upload', bulkUploadRouter);

// Mount engineers routes
const engineersRouter = require('./engineers');
router.use('/engineers', engineersRouter);

// Apply authentication to all routes
router.use(authenticateToken);

// GET /users/statistics - Get user statistics
router.get('/statistics',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const statsQuery = `
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_count,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user_count,
        SUM(CASE WHEN role = 'coordinator' THEN 1 ELSE 0 END) as coordinator_count,
        SUM(CASE WHEN role = 'engineer' THEN 1 ELSE 0 END) as engineer_count,
        SUM(CASE WHEN role = 'superadmin' THEN 1 ELSE 0 END) as superadmin_count,
        SUM(CASE WHEN user_status = 'pending' THEN 1 ELSE 0 END) as pending_approvals
      FROM USER_MASTER
    `;

    const result = await pool.request().query(statsQuery);
    const stats = result.recordset[0];

    sendSuccess(res, {
      total: stats.total_users || 0,
      active: stats.active_users || 0,
      inactive: stats.inactive_users || 0,
      byRole: {
        admin: stats.admin_count || 0,
        user: stats.user_count || 0,
        coordinator: stats.coordinator_count || 0,
        engineer: stats.engineer_count || 0,
        superadmin: stats.superadmin_count || 0
      },
      pendingApprovals: stats.pending_approvals || 0
    });
  })
);

// GET /users - List all users with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, role, department_id, location_id, board_id } = req.query;

    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (u.first_name LIKE @search OR u.last_name LIKE @search OR u.email LIKE @search OR u.employee_id LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND u.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (role) {
      whereClause += ' AND u.role = @role';
      params.push({ name: 'role', type: sql.VarChar(50), value: role });
    }

    if (board_id) {
      // Filter users by board - users whose department belongs to the specified board
      whereClause += ` AND u.department_id IN (
        SELECT department_id
        FROM BOARD_DEPARTMENTS
        WHERE board_id = @boardId
      )`;
      params.push({ name: 'boardId', type: sql.UniqueIdentifier, value: board_id });
    }

    if (department_id) {
      whereClause += ' AND u.department_id = @departmentId';
      params.push({ name: 'departmentId', type: sql.UniqueIdentifier, value: department_id });
    }

    if (location_id) {
      whereClause += ' AND u.location_id = @locationId';
      params.push({ name: 'locationId', type: sql.UniqueIdentifier, value: location_id });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM USER_MASTER u
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['first_name', 'last_name', 'email', 'role', 'employee_id', 'created_at', 'last_login'];
    const safeSortBy = validSortFields.includes(sortBy) ? `u.${sortBy}` : 'u.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT u.user_id, u.first_name, u.last_name, u.email, u.role,
             u.employee_id, u.is_active, u.last_login, u.created_at, u.updated_at,
             d.department_name, d.department_id,
             l.name as location_name, l.id as location_id
      FROM USER_MASTER u
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    // Don't return sensitive data
    const users = result.recordset.map(user => ({
      id: user.user_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
      isActive: user.is_active,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      department: {
        id: user.department_id,
        name: user.department_name
      },
      location: {
        id: user.location_id,
        name: user.location_name
      },
      manager: null
    }));

    sendSuccess(res, {
      users,
      pagination
    }, 'Users retrieved successfully');
  })
);

// GET /users/export - Export users to Excel
router.get('/export',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { status, role, search } = req.query;
    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];

    if (status === 'active') {
      whereClause += ' AND u.is_active = 1';
    } else if (status === 'inactive') {
      whereClause += ' AND u.is_active = 0';
    }

    if (role) {
      whereClause += ' AND u.role = @role';
      params.push({ name: 'role', type: sql.VarChar(50), value: role });
    }

    if (search) {
      whereClause += ' AND (u.first_name LIKE @search OR u.last_name LIKE @search OR u.email LIKE @search OR u.employee_id LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    // Fetch users
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        u.user_id as id,
        u.first_name,
        u.last_name,
        u.email,
        u.employee_id,
        u.role,
        u.is_active,
        d.department_name,
        l.name as location_name,
        l.building as location_building,
        l.floor as location_floor,
        u.created_at
      FROM USER_MASTER u
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE ${whereClause}
      ORDER BY u.created_at DESC
    `);

    // Create Excel workbook
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users');

    // Add headers
    worksheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'First Name', key: 'first_name', width: 20 },
      { header: 'Last Name', key: 'last_name', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Department', key: 'department_name', width: 25 },
      { header: 'Location', key: 'location_name', width: 25 },
      { header: 'Building', key: 'location_building', width: 20 },
      { header: 'Floor', key: 'location_floor', width: 15 },
      { header: 'Status', key: 'is_active', width: 10 },
      { header: 'Created At', key: 'created_at', width: 20 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    result.recordset.forEach(user => {
      worksheet.addRow({
        employee_id: user.employee_id || '',
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        department_name: user.department_name || '',
        location_name: user.location_name || '',
        location_building: user.location_building || '',
        location_floor: user.location_floor || '',
        is_active: user.is_active ? 'Active' : 'Inactive',
        created_at: user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : ''
      });
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=users_export_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buffer);
  })
);

// GET /users/:id/assets - Get assets assigned to a specific user
// IMPORTANT: This route must come BEFORE /:id to avoid route conflicts
router.get('/:id/assets',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, is_active } = req.query;

    const pool = await connectDB();

    // Check if user exists
    const userCheck = await pool.request()
      .input('userId', sql.UniqueIdentifier, id)
      .query('SELECT user_id FROM USER_MASTER WHERE user_id = @userId');

    if (userCheck.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    // Build WHERE clause for assets
    let whereClause = 'a.assigned_to = @userId';
    const params = [{ name: 'userId', type: sql.UniqueIdentifier, value: id }];

    // Filter by status if provided (default to 'assigned')
    const assetStatus = status || 'assigned';
    whereClause += ' AND a.status = @status';
    params.push({ name: 'status', type: sql.VarChar(20), value: assetStatus });

    // Filter by is_active if provided (default to true)
    const activeFilter = is_active !== undefined ? is_active === 'true' : true;
    whereClause += ' AND a.is_active = @isActive';
    params.push({ name: 'isActive', type: sql.Bit, value: activeFilter });

    // Query to get user's assets
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        a.id, a.asset_tag, a.tag_no, a.serial_number, a.status, a.condition_status,
        a.purchase_date, a.warranty_end_date, a.purchase_cost, a.notes,
        a.created_at, a.updated_at, a.product_id, a.assigned_to,
        a.asset_type, a.parent_asset_id, a.installation_date, a.removal_date,
        p.name as product_name, p.model as product_model,
        c.id as category_id, c.name as category_name,
        o.id as oem_id, o.name as oem_name,
        CASE
          WHEN a.warranty_end_date IS NULL THEN 'No Warranty'
          WHEN a.warranty_end_date < GETUTCDATE() THEN 'Expired'
          WHEN a.warranty_end_date BETWEEN GETUTCDATE() AND DATEADD(day, 30, GETUTCDATE()) THEN 'Expiring Soon'
          ELSE 'Active'
        END as warranty_status
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN oems o ON p.oem_id = o.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
    `);

    sendSuccess(res, {
      assets: result.recordset,
      total: result.recordset.length,
      userId: id
    }, 'User assets retrieved successfully');
  })
);

// GET /users/:id - Get user by ID
router.get('/:id',
  validateUUID('id'),
  requireSelfOrRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.DEPARTMENT_HEAD, USER_ROLES.COORDINATOR]),
  asyncHandler(async (req, res) => {

    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT u.user_id, u.first_name, u.last_name, u.email, u.role,
               u.employee_id, u.is_active, u.last_login, u.created_at, u.updated_at,
               u.password_changed_at, u.failed_login_attempts, u.locked_until,
               d.department_name, d.department_id,
               l.name as location_name, l.id as location_id
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE u.user_id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    const user = result.recordset[0];
    
    const userData = {
      id: user.user_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
      isActive: user.is_active,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      passwordChangedAt: user.password_changed_at,
      failedLoginAttempts: user.failed_login_attempts,
      lockedUntil: user.locked_until,
      department: {
        id: user.department_id,
        name: user.department_name
      },
      location: {
        id: user.location_id,
        name: user.location_name
      },
      manager: null,
      permissions: authConfig.ROLE_PERMISSIONS[user.role] || []
    };

    sendSuccess(res, userData, 'User retrieved successfully');
  })
);

// POST /users - Create new user
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.user.create),
  asyncHandler(async (req, res) => {
    const {
      first_name,
      last_name,
      email,
      password,
      role,
      department_id,
      location_id,
      employee_id,
      is_active = true
    } = req.body;

    const pool = await connectDB();

    // Auto-generate email if not provided
    let finalEmail = email;
    if (!finalEmail || finalEmail.trim() === '') {
      finalEmail = await generateUniqueEmail(first_name, last_name);
    }

    // Check if user with same email already exists
    const existingUserResult = await pool.request()
      .input('email', sql.VarChar(255), finalEmail.toLowerCase())
      .query('SELECT user_id FROM USER_MASTER WHERE LOWER(email) = LOWER(@email)');

    if (existingUserResult.recordset.length > 0) {
      return sendConflict(res, 'User with this email already exists');
    }

    // Check if employee_id is provided and already exists
    if (employee_id) {
      const existingEmployeeResult = await pool.request()
        .input('employeeId', sql.VarChar(20), employee_id)
        .query('SELECT user_id FROM USER_MASTER WHERE employee_id = @employeeId');

      if (existingEmployeeResult.recordset.length > 0) {
        return sendConflict(res, 'User with this employee ID already exists');
      }
    }

    // Verify that referenced entities exist
    if (department_id) {
      const departmentResult = await pool.request()
        .input('departmentId', sql.UniqueIdentifier, department_id)
        .query('SELECT COUNT(*) as count FROM DEPARTMENT_MASTER WHERE department_id = @departmentId');

      if (departmentResult.recordset[0].count === 0) {
        return sendNotFound(res, 'Department not found or inactive');
      }
    }

    if (location_id) {
      const locationResult = await pool.request()
        .input('locationId', sql.UniqueIdentifier, location_id)
        .query('SELECT COUNT(*) as count FROM locations WHERE id = @locationId AND is_active = 1');

      if (locationResult.recordset[0].count === 0) {
        return sendNotFound(res, 'Location not found or inactive');
      }
    }

    // Generate employee_id if not provided
    let finalEmployeeId = employee_id;
    if (!finalEmployeeId) {
      // Generate sequential employee ID starting with T-10000
      // Get the highest existing employee ID that matches the pattern T-#####
      const maxIdResult = await pool.request()
        .query(`
          SELECT TOP 1 employee_id
          FROM USER_MASTER
          WHERE employee_id LIKE 'T-%'
            AND LEN(employee_id) = 7
            AND ISNUMERIC(SUBSTRING(employee_id, 3, 5)) = 1
          ORDER BY CAST(SUBSTRING(employee_id, 3, 5) AS INT) DESC
        `);

      let nextNumber = 10000; // Starting number
      if (maxIdResult.recordset.length > 0 && maxIdResult.recordset[0].employee_id) {
        const currentMax = maxIdResult.recordset[0].employee_id;
        const currentNumber = parseInt(currentMax.substring(2)); // Extract number after 'T-'
        nextNumber = currentNumber + 1;
      }

      finalEmployeeId = `T-${nextNumber}`;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, authConfig.bcrypt.saltRounds);

    const userId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, userId)
      .input('firstName', sql.VarChar(50), first_name.trim())
      .input('lastName', sql.VarChar(50), last_name.trim())
      .input('email', sql.VarChar(255), finalEmail.toLowerCase())
      .input('passwordHash', sql.VarChar(255), passwordHash)
      .input('role', sql.VarChar(50), role)
      .input('departmentId', sql.UniqueIdentifier, department_id)
      .input('locationId', sql.UniqueIdentifier, location_id)
      .input('employeeId', sql.VarChar(20), finalEmployeeId)
      .input('isActive', sql.Bit, is_active)
      .input('registrationType', sql.VarChar(20), 'admin-created')
      .input('userStatus', sql.VarChar(20), is_active ? 'active' : 'pending')
      .query(`
        INSERT INTO USER_MASTER (
          user_id, first_name, last_name, email, password_hash, role,
          department_id, location_id, employee_id, is_active, registration_type, user_status,
          created_at, updated_at
        )
        VALUES (
          @id, @firstName, @lastName, @email, @passwordHash, @role,
          @departmentId, @locationId, @employeeId, @isActive, @registrationType, @userStatus,
          GETUTCDATE(), GETUTCDATE()
        );
        
        SELECT u.user_id, u.first_name, u.last_name, u.email, u.role,
               u.employee_id, u.is_active, u.created_at, u.updated_at,
               d.department_name, d.department_id,
               l.name as location_name, l.id as location_id
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE u.user_id = @id;
      `);

    const user = result.recordset[0];

    const userData = {
      id: user.user_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
      isActive: user.is_active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      department: {
        id: user.department_id,
        name: user.department_name
      },
      location: {
        id: user.location_id,
        name: user.location_name
      },
      manager: null
    };

    sendCreated(res, userData, 'User created successfully');
  })
);

// PUT /users/:id - Update user
router.put('/:id',
  validateUUID('id'),
  requireSelfOrRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.DEPARTMENT_HEAD]),
  validateBody(validators.user.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      role,
      department_id,
      location_id,
      employee_id,
      is_active
    } = req.body;

    const pool = await connectDB();
    
    // Check if user exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT user_id, email, employee_id, role FROM USER_MASTER WHERE user_id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    const existingUser = existingResult.recordset[0];

    // Only allow users to update their own profile (limited fields) or admins to update any user
    const isOwnProfile = req.user.id === id;
    const canUpdateAllFields = [USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.DEPARTMENT_HEAD].includes(req.user.role);

    if (isOwnProfile && !canUpdateAllFields) {
      // Users can only update their own name
      if (role || department_id || location_id || employee_id || is_active !== undefined) {
        return sendError(res, 'You can only update your name', 403);
      }
    }

    // Check for email conflicts if being updated
    if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
      const emailConflictResult = await pool.request()
        .input('email', sql.VarChar(255), email.toLowerCase())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT user_id FROM USER_MASTER WHERE LOWER(email) = LOWER(@email) AND user_id != @id');

      if (emailConflictResult.recordset.length > 0) {
        return sendConflict(res, 'User with this email already exists');
      }
    }

    // Check for employee_id conflicts if being updated
    if (employee_id && employee_id !== existingUser.employee_id) {
      const employeeConflictResult = await pool.request()
        .input('employeeId', sql.VarChar(20), employee_id)
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT user_id FROM USER_MASTER WHERE employee_id = @employeeId AND user_id != @id');

      if (employeeConflictResult.recordset.length > 0) {
        return sendConflict(res, 'User with this employee ID already exists');
      }
    }

    // Prevent users from changing their own role to higher privilege
    if (role && role !== existingUser.role && isOwnProfile) {
      return sendError(res, 'You cannot change your own role', 403);
    }

    // Verify that referenced entities exist (if being updated)
    if (department_id) {
      const departmentResult = await pool.request()
        .input('departmentId', sql.UniqueIdentifier, department_id)
        .query('SELECT COUNT(*) as count FROM DEPARTMENT_MASTER WHERE department_id = @departmentId');

      if (departmentResult.recordset[0].count === 0) {
        return sendNotFound(res, 'Department not found or inactive');
      }
    }

    if (location_id) {
      const locationResult = await pool.request()
        .input('locationId', sql.UniqueIdentifier, location_id)
        .query('SELECT COUNT(*) as count FROM locations WHERE id = @locationId AND is_active = 1');

      if (locationResult.recordset[0].count === 0) {
        return sendNotFound(res, 'Location not found or inactive');
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (first_name !== undefined) {
      updateFields.push('first_name = @firstName');
      updateRequest.input('firstName', sql.VarChar(50), first_name.trim());
    }
    if (last_name !== undefined) {
      updateFields.push('last_name = @lastName');
      updateRequest.input('lastName', sql.VarChar(50), last_name.trim());
    }
    if (email !== undefined) {
      updateFields.push('email = @email');
      updateRequest.input('email', sql.VarChar(255), email.toLowerCase());
    }
    
    // Only allow admins to update these fields
    if (canUpdateAllFields) {
      if (role !== undefined) {
        updateFields.push('role = @role');
        updateRequest.input('role', sql.VarChar(50), role);
      }
      if (department_id !== undefined) {
        updateFields.push('department_id = @departmentId');
        updateRequest.input('departmentId', sql.UniqueIdentifier, department_id);
      }
      if (location_id !== undefined) {
        updateFields.push('location_id = @locationId');
        updateRequest.input('locationId', sql.UniqueIdentifier, location_id);
      }
      if (employee_id !== undefined) {
        updateFields.push('employee_id = @employeeId');
        updateRequest.input('employeeId', sql.VarChar(20), employee_id);
      }
      if (is_active !== undefined) {
        updateFields.push('is_active = @isActive');
        updateRequest.input('isActive', sql.Bit, is_active);
      }
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const result = await updateRequest.query(`
      UPDATE USER_MASTER 
      SET ${updateFields.join(', ')}
      WHERE user_id = @id;
      
      SELECT u.user_id, u.first_name, u.last_name, u.email, u.role,
             u.employee_id, u.is_active, u.created_at, u.updated_at,
             d.department_name, d.department_id,
             l.name as location_name, l.id as location_id
      FROM USER_MASTER u
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE u.user_id = @id;
    `);

    const user = result.recordset[0];

    const userData = {
      id: user.user_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
      isActive: user.is_active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      department: {
        id: user.department_id,
        name: user.department_name
      },
      location: {
        id: user.location_id,
        name: user.location_name
      },
      manager: null
    };

    sendSuccess(res, userData, 'User updated successfully');
  })
);

// DELETE /users/:id - Delete user (soft delete)
router.delete('/:id',
  validateUUID('id'),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if user exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    // Prevent users from deleting themselves
    if (req.user.id === id) {
      return sendError(res, 'You cannot delete your own account', 403);
    }

    // Complete user data cleanup process
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // 1. Unassign all assets from this user (don't delete assets)
      await transaction.request()
        .input('userId', sql.UniqueIdentifier, id)
        .query('UPDATE assets SET assigned_to = NULL WHERE assigned_to = @userId');

      // 2. Clean up OAuth tokens (these tables exist and have CASCADE DELETE)
      await transaction.request()
        .input('userId', sql.UniqueIdentifier, id)
        .query('DELETE FROM oauth_access_tokens WHERE user_id = @userId');

      await transaction.request()
        .input('userId', sql.UniqueIdentifier, id)
        .query('DELETE FROM oauth_refresh_tokens WHERE user_id = @userId');

      // 3. Mark user as deleted (soft delete)
      await transaction.request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`
          UPDATE USER_MASTER
          SET is_active = 0, user_status = 'deleted', updated_at = GETUTCDATE()
          WHERE user_id = @id
        `);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    sendSuccess(res, null, 'User deleted successfully');
  })
);

// GET /users/list - Simple users list for dropdowns
router.get('/list',
  authenticateToken,
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { limit = 100, search, role } = req.query;
    
    const pool = await connectDB();
    
    let whereClause = 'is_active = 1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (first_name LIKE @search OR last_name LIKE @search OR email LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (role) {
      whereClause += ' AND role = @role';
      params.push({ name: 'role', type: sql.VarChar(50), value: role });
    }
    
    const request = pool.request()
      .input('limit', sql.Int, limit);
    
    params.forEach(param => request.input(param.name, param.type, param.value));
    
    const result = await request.query(`
      SELECT user_id as id, first_name, last_name, email, role
      FROM USER_MASTER
      WHERE ${whereClause}
      ORDER BY first_name, last_name
      OFFSET 0 ROWS
      FETCH NEXT @limit ROWS ONLY
    `);
    
    const users = result.recordset.map(user => ({
      id: user.id,
      name: `${user.first_name} ${user.last_name}`,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role
    }));
    
    sendSuccess(res, { users }, 'Users list retrieved successfully');
  })
);

// GET /users/:id/subordinates - Get users reporting to this manager
router.get('/:id/subordinates',
  validateUUID('id'),
  requireSelfOrRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.DEPARTMENT_HEAD, USER_ROLES.COORDINATOR]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if manager exists
    const managerResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT first_name, last_name, role FROM USER_MASTER WHERE user_id = @id');

    if (managerResult.recordset.length === 0) {
      return sendNotFound(res, 'Manager not found');
    }

    // Manager hierarchy removed, return empty subordinates list
    const subordinates = [];

    sendSuccess(res, {
      manager: managerResult.recordset[0],
      subordinates
    }, 'Subordinates retrieved successfully');
  })
);

// POST /users/:id/reset-password - Reset user password (admin only)
router.post('/:id/reset-password',
  validateUUID('id'),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    let { new_password } = req.body;

    const pool = await connectDB();

    // Check if user exists and get user details
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT user_id, email, first_name, last_name FROM USER_MASTER WHERE user_id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    const user = existingResult.recordset[0];

    // Auto-generate password if not provided
    let passwordGenerated = false;
    if (!new_password || new_password.trim() === '') {
      new_password = generateSecurePassword(12);
      passwordGenerated = true;
    } else if (new_password.length < 8) {
      return sendError(res, 'New password must be at least 8 characters long', 400);
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(new_password, authConfig.bcrypt.saltRounds);

    // Update password and reset failed attempts
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('passwordHash', sql.VarChar(255), passwordHash)
      .query(`
        UPDATE USER_MASTER
        SET password_hash = @passwordHash,
            failed_login_attempts = 0,
            account_locked_until = NULL,
            updated_at = GETUTCDATE()
        WHERE user_id = @id
      `);

    // Remove all refresh tokens to force re-login (optional, wrap in try-catch in case table doesn't exist)
    try {
      await pool.request()
        .input('userId', sql.UniqueIdentifier, id)
        .query('DELETE FROM oauth_refresh_tokens WHERE user_id = @userId');
    } catch (error) {
      // Silently fail if oauth_refresh_tokens table doesn't exist
      console.log('Note: Could not revoke refresh tokens (table may not exist)');
    }

    // Return response with generated password if applicable
    const responseData = passwordGenerated ? {
      passwordGenerated: true,
      newPassword: new_password,
      user: {
        id: user.user_id,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`
      }
    } : null;

    sendSuccess(
      res,
      responseData,
      passwordGenerated
        ? 'Password reset successfully with auto-generated password. Please share the new password with the user securely.'
        : 'Password reset successfully. User must login with new password.'
    );
  })
);

// POST /users/:id/unlock - Unlock user account (admin only)
router.post('/:id/unlock',
  validateUUID('id'),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if user exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT user_id, email, locked_until FROM USER_MASTER WHERE user_id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    // Reset failed attempts and unlock
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE USER_MASTER 
        SET failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = GETUTCDATE()
        WHERE user_id = @id
      `);

    sendSuccess(res, null, 'User account unlocked successfully');
  })
);

module.exports = router;