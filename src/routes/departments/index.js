const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { requireRole } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
// const { permissions, USER_ROLES } = require('../../config/auth');
const { roles: USER_ROLES } = require('../../config/auth');
const validators = require('../../utils/validators');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);


// GET /departments - List all departments with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, parent_id } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (d.department_name LIKE @search OR d.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM DEPARTMENT_MASTER d
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['department_name', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `d.${sortBy}` : 'd.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT d.department_id, d.department_name, d.description, d.contact_person_id,
             d.created_at, d.updated_at,
             u.first_name as contact_first_name, u.last_name as contact_last_name, u.email as contact_email
      FROM DEPARTMENT_MASTER d
      LEFT JOIN USER_MASTER u ON d.contact_person_id = u.user_id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    const departments = result.recordset.map(dept => ({
      id: dept.department_id,
      name: dept.department_name,
      description: dept.description,
      contactPersonId: dept.contact_person_id,
      createdAt: dept.created_at,
      updatedAt: dept.updated_at,
      contactPerson: dept.contact_first_name ? {
        id: dept.contact_person_id,
        firstName: dept.contact_first_name,
        lastName: dept.contact_last_name,
        email: dept.contact_email
      } : null
    }));

    sendSuccess(res, {
      departments,
      pagination
    }, 'Departments retrieved successfully');
  })
);

// SPECIFIC ROUTES FIRST (before parameterized routes)

// GET /departments/hierarchy - Get departments in tree structure  
router.get('/hierarchy',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { status } = req.query;

    const pool = await connectDB();
    
    let whereClause = '1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    const request = pool.request();
    params.forEach(param => request.input(param.name, param.type, param.value));

    const result = await request.query(`
      WITH DepartmentHierarchy AS (
        -- Root departments
        SELECT d.id, d.name, d.description, d.parent_department_id, d.budget, d.is_active, 
               d.created_at, d.updated_at, 0 as level,
               h.first_name as head_first_name, h.last_name as head_last_name, h.id as head_user_id
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER h ON d.head_user_id = h.user_id
        WHERE d.parent_department_id IS NULL AND ${whereClause}
        
        UNION ALL
        
        -- Child departments
        SELECT d.id, d.name, d.description, d.parent_department_id, d.budget, d.is_active, 
               d.created_at, d.updated_at, dh.level + 1,
               h.first_name as head_first_name, h.last_name as head_last_name, h.id as head_user_id
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER h ON d.head_user_id = h.user_id
        INNER JOIN DepartmentHierarchy dh ON d.parent_department_id = dh.id
        WHERE d.is_active = 1
      )
      SELECT id, name, description, parent_department_id, budget, is_active, created_at, updated_at, level,
             head_first_name, head_last_name, head_user_id
      FROM DepartmentHierarchy
      ORDER BY level, name
    `);

    // Build tree structure
    const buildTree = (departments, parentId = null, level = 0) => {
      return departments
        .filter(dept => {
          if (level === 0) return dept.parent_department_id === null;
          return dept.parent_department_id === parentId;
        })
        .map(dept => ({
          id: dept.id,
          name: dept.name,
          description: dept.description,
          parentDepartmentId: dept.parent_department_id,
          budget: dept.budget,
          isActive: dept.is_active,
          createdAt: dept.created_at,
          updatedAt: dept.updated_at,
          level: dept.level,
          head: dept.head_first_name ? {
            id: dept.head_user_id,
            firstName: dept.head_first_name,
            lastName: dept.head_last_name
          } : null,
          children: buildTree(departments, dept.id, level + 1)
        }));
    };

    const tree = buildTree(result.recordset);

    sendSuccess(res, tree, 'Department hierarchy retrieved successfully');
  })
);

// GET /departments/users - Get users from USER_MASTER for department forms (contact person dropdown)
router.get('/users',
  (req, res, next) => {
    console.log('=== DEBUG /departments/users ===');
    console.log('Route params:', req.params);
    console.log('Query params:', req.query);
    console.log('Original URL:', req.originalUrl);
    console.log('Path:', req.path);
    next();
  },
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { limit = 100, search } = req.query;
    
    const pool = await connectDB();
    
    // Filter for department heads only (for contact person dropdown)
    let whereClause = 'is_active = 1 AND role = @role';
    const params = [
      { name: 'role', type: sql.VarChar(50), value: 'department_head' }
    ];
    
    if (search) {
      whereClause += ' AND (first_name LIKE @search OR last_name LIKE @search OR email LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    const request = pool.request()
      .input('limit', sql.Int, limit);
    
    params.forEach(param => request.input(param.name, param.type, param.value));
    
    const result = await request.query(`
      SELECT user_id as id, first_name, last_name, email, role, is_active
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
      role: user.role,
      isActive: user.is_active
    }));
    
    sendSuccess(res, { users }, 'Users retrieved successfully');
  })
);

// GET /departments/list - Simple departments list for dropdowns
router.get('/list',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { limit = 100, search } = req.query;
    
    const pool = await connectDB();
    
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND department_name LIKE @search';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    const request = pool.request()
      .input('limit', sql.Int, limit);
    
    params.forEach(param => request.input(param.name, param.type, param.value));
    
    const result = await request.query(`
      SELECT department_id as id, department_name as name
      FROM DEPARTMENT_MASTER
      WHERE ${whereClause}
      ORDER BY department_name
      OFFSET 0 ROWS
      FETCH NEXT @limit ROWS ONLY
    `);
    
    const departments = result.recordset.map(dept => ({
      id: dept.id,
      name: dept.name
    }));
    
    sendSuccess(res, { departments }, 'Departments list retrieved successfully');
  })
);

// PARAMETERIZED ROUTES LAST

// GET /departments/:id - Get department by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT d.department_id, d.department_name, d.description, d.contact_person_id, 
               d.created_at, d.updated_at,
               u.first_name as contact_first_name, u.last_name as contact_last_name, 
               u.email as contact_email,
               (SELECT COUNT(*) FROM USER_MASTER WHERE department_id = d.department_id AND is_active = 1) as user_count
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER u ON d.contact_person_id = u.user_id
        WHERE d.department_id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Department not found');
    }

    const dept = result.recordset[0];
    
    const departmentData = {
      id: dept.department_id,
      name: dept.department_name,
      description: dept.description,
      contactPersonId: dept.contact_person_id,
      createdAt: dept.created_at,
      updatedAt: dept.updated_at,
      contactPerson: dept.contact_first_name ? {
        id: dept.contact_person_id,
        firstName: dept.contact_first_name,
        lastName: dept.contact_last_name,
        email: dept.contact_email
      } : null,
      userCount: dept.user_count
    };

    sendSuccess(res, departmentData, 'Department retrieved successfully');
  })
);

// POST /departments - Create new department
router.post('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  validateBody(validators.department.create),
  asyncHandler(async (req, res) => {
    const { 
      name, 
      description, 
      contact_person_id
    } = req.body;

    const pool = await connectDB();
    
    // Check if department with same name already exists
    const nameCheckRequest = pool.request().input('name', sql.VarChar(100), name.trim());
    
    const nameCheckQuery = 'SELECT department_id FROM DEPARTMENT_MASTER WHERE LOWER(department_name) = LOWER(@name)';
    const existingResult = await nameCheckRequest.query(nameCheckQuery);

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Department with this name already exists');
    }

    // Verify contact person exists if provided (and not null/empty)
    if (contact_person_id && contact_person_id.trim() !== '') {
      try {
        const contactPersonResult = await pool.request()
          .input('contactPersonId', sql.UniqueIdentifier, contact_person_id)
          .query('SELECT user_id FROM USER_MASTER WHERE user_id = @contactPersonId AND is_active = 1');

        if (contactPersonResult.recordset.length === 0) {
          return sendNotFound(res, 'Contact person not found or inactive');
        }
      } catch (error) {
        return sendError(res, 'Invalid contact person ID format', 400);
      }
    }

    const departmentId = uuidv4();
    const result = await pool.request()
      .input('departmentId', sql.UniqueIdentifier, departmentId)
      .input('departmentName', sql.VarChar(100), name.trim())
      .input('description', sql.Text, description)
      .input('contactPersonId', sql.UniqueIdentifier, (contact_person_id && contact_person_id.trim() !== '') ? contact_person_id : null)
      .query(`
        INSERT INTO DEPARTMENT_MASTER (department_id, department_name, description, contact_person_id, created_at, updated_at)
        VALUES (@departmentId, @departmentName, @description, @contactPersonId, GETUTCDATE(), GETUTCDATE());
        
        SELECT d.department_id, d.department_name, d.description, d.contact_person_id, d.created_at, d.updated_at,
               u.first_name as contact_first_name, u.last_name as contact_last_name, u.email as contact_email
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER u ON d.contact_person_id = u.user_id
        WHERE d.department_id = @departmentId;
      `);

    const dept = result.recordset[0];
    
    const departmentData = {
      id: dept.department_id,
      name: dept.department_name,
      description: dept.description,
      contactPersonId: dept.contact_person_id,
      createdAt: dept.created_at,
      updatedAt: dept.updated_at,
      contactPerson: dept.contact_first_name ? {
        id: dept.contact_person_id,
        firstName: dept.contact_first_name,
        lastName: dept.contact_last_name,
        email: dept.contact_email
      } : null
    };

    sendCreated(res, departmentData, 'Department created successfully');
  })
);

// PUT /departments/:id - Update department
router.put('/:id',
  validateUUID('id'),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  validateBody(validators.department.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, contact_person_id } = req.body;

    const pool = await connectDB();
    
    // Check if department exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT department_id, department_name FROM DEPARTMENT_MASTER WHERE department_id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Department not found');
    }

    const existingDept = existingResult.recordset[0];

    // Check for name conflicts if name is being updated
    if (name && name.trim() !== existingDept.department_name) {
      const nameCheckRequest = pool.request()
        .input('name', sql.VarChar(100), name.trim())
        .input('id', sql.UniqueIdentifier, id);
      
      const nameCheckQuery = 'SELECT department_id FROM DEPARTMENT_MASTER WHERE LOWER(department_name) = LOWER(@name) AND department_id != @id';
      const nameConflictResult = await nameCheckRequest.query(nameCheckQuery);

      if (nameConflictResult.recordset.length > 0) {
        return sendConflict(res, 'Department with this name already exists');
      }
    }

    // Verify contact person exists if being updated (and not null/empty)
    if (contact_person_id && contact_person_id.trim() !== '') {
      try {
        const contactPersonResult = await pool.request()
          .input('contactPersonId', sql.UniqueIdentifier, contact_person_id)
          .query('SELECT user_id, first_name, last_name, is_active FROM USER_MASTER WHERE user_id = @contactPersonId');

        if (contactPersonResult.recordset.length === 0) {
          return sendNotFound(res, `Contact person with ID ${contact_person_id} not found`);
        }

        const user = contactPersonResult.recordset[0];
        if (!user.is_active) {
          return sendError(res, `Contact person ${user.first_name} ${user.last_name} is inactive`, 400);
        }
      } catch (error) {
        console.error('Error validating contact person:', error);
        return sendError(res, 'Invalid contact person ID format', 400);
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updateFields.push('department_name = @name');
      updateRequest.input('name', sql.VarChar(100), name.trim());
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateRequest.input('description', sql.Text, description);
    }
    if (contact_person_id !== undefined) {
      updateFields.push('contact_person_id = @contactPersonId');
      const contactPersonValue = (contact_person_id && contact_person_id.trim() !== '') ? contact_person_id : null;
      updateRequest.input('contactPersonId', sql.UniqueIdentifier, contactPersonValue);
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    let result;
    try {
      result = await updateRequest.query(`
        UPDATE DEPARTMENT_MASTER 
        SET ${updateFields.join(', ')}
        WHERE department_id = @id;
        
        SELECT d.department_id, d.department_name, d.description, d.contact_person_id, d.created_at, d.updated_at,
               u.first_name as contact_first_name, u.last_name as contact_last_name, u.email as contact_email
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER u ON d.contact_person_id = u.user_id
        WHERE d.department_id = @id;
      `);
    } catch (error) {
      console.error('Database error in department update:', error);
      console.error('Error details:', error.message);
      console.error('SQL State:', error.originalError?.info?.state);
      
      if (error.message && error.message.includes('FOREIGN KEY constraint')) {
        return sendError(res, `The selected contact person (ID: ${contact_person_id}) does not exist or is not valid. Please select a different contact person.`, 400, 'FOREIGN_KEY_VIOLATION');
      }
      throw error;
    }

    const dept = result.recordset[0];
    
    const departmentData = {
      id: dept.department_id,
      name: dept.department_name,
      description: dept.description,
      contactPersonId: dept.contact_person_id,
      createdAt: dept.created_at,
      updatedAt: dept.updated_at,
      contactPerson: dept.contact_first_name ? {
        id: dept.contact_person_id,
        firstName: dept.contact_first_name,
        lastName: dept.contact_last_name,
        email: dept.contact_email
      } : null
    };

    sendSuccess(res, departmentData, 'Department updated successfully');
  })
);

// DELETE /departments/:id - Delete department
router.delete('/:id',
  validateUUID('id'),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if department exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT department_id FROM DEPARTMENT_MASTER WHERE department_id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Department not found');
    }

    // Check if department has users
    const usersResult = await pool.request()
      .input('deptId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM USER_MASTER WHERE department_id = @deptId AND is_active = 1');

    if (usersResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete department. It has active users.');
    }

    // Hard delete from DEPARTMENT_MASTER (since it doesn't have is_active field)
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        DELETE FROM DEPARTMENT_MASTER 
        WHERE department_id = @id
      `);

    sendSuccess(res, null, 'Department deleted successfully');
  })
);

// GET /departments/:id/users - Get users in a department
router.get('/:id/users',
  requireDynamicPermission(),
  validateUUID('id'),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit, offset } = req.pagination;

    const pool = await connectDB();
    
    // Check if department exists
    const deptResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT name FROM DEPARTMENT_MASTER WHERE id = @id');

    if (deptResult.recordset.length === 0) {
      return sendNotFound(res, 'Department not found');
    }

    // Get total count of users in this department
    const countResult = await pool.request()
      .input('deptId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as total FROM USER_MASTER WHERE department_id = @deptId AND is_active = 1');
    
    const total = countResult.recordset[0].total;

    // Get paginated users
    const result = await pool.request()
      .input('deptId', sql.UniqueIdentifier, id)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT u.user_id as id, u.first_name, u.last_name, u.email, u.role, 
               u.employee_id, u.is_active, u.last_login,
               m.first_name as manager_first_name, m.last_name as manager_last_name
        FROM USER_MASTER u
        WHERE u.department_id = @deptId AND u.is_active = 1
        ORDER BY u.role, u.first_name, u.last_name
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    const pagination = getPaginationInfo(page, limit, total);

    const users = result.recordset.map(user => ({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
      isActive: user.is_active,
      lastLogin: user.last_login,
      manager: user.manager_first_name ? {
        firstName: user.manager_first_name,
        lastName: user.manager_last_name
      } : null
    }));

    sendSuccess(res, {
      department: deptResult.recordset[0],
      users,
      pagination
    }, 'Department users retrieved successfully');
  })
);

// GET /departments/:id/sub-departments - Get sub-departments
router.get('/:id/sub-departments',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if parent department exists
    const parentResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT name FROM DEPARTMENT_MASTER WHERE id = @id');

    if (parentResult.recordset.length === 0) {
      return sendNotFound(res, 'Parent department not found');
    }

    const result = await pool.request()
      .input('parentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT d.id, d.name, d.description, d.budget, d.is_active, d.created_at, d.updated_at,
               h.first_name as head_first_name, h.last_name as head_last_name,
               (SELECT COUNT(*) FROM USER_MASTER WHERE department_id = d.id AND is_active = 1) as user_count
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER h ON d.head_user_id = h.user_id
        WHERE d.parent_department_id = @parentId AND d.is_active = 1
        ORDER BY d.name
      `);

    const subDepartments = result.recordset.map(dept => ({
      id: dept.id,
      name: dept.name,
      description: dept.description,
      budget: dept.budget,
      isActive: dept.is_active,
      createdAt: dept.created_at,
      updatedAt: dept.updated_at,
      head: dept.head_first_name ? {
        firstName: dept.head_first_name,
        lastName: dept.head_last_name
      } : null,
      userCount: dept.user_count
    }));

    sendSuccess(res, {
      parentDepartment: parentResult.recordset[0],
      subDepartments
    }, 'Sub-departments retrieved successfully');
  })
);

module.exports = router;