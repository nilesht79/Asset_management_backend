const express = require('express')
const router = express.Router()
const { auth } = require('../../middleware/auth')
const { rbac } = require('../../middleware/permissions')
const { validateRequest } = require('../../middleware/validation')
const { body, param, query } = require('express-validator')
const { getDbConnection } = require('../../config/database')
const bcrypt = require('bcryptjs')

const adminValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('permissions').optional().isArray().withMessage('Permissions must be an array'),
  body('accessLevel').optional().isIn(['admin', 'superadmin']).withMessage('Valid access level required')
]

const createAdminValidation = [
  ...adminValidation,
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number and one special character')
]

router.get('/', 
  auth,
  rbac(['superadmin']),
  async (req, res) => {
    try {
      const { accessLevel, status, search, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      let query = `
        SELECT a.*, 
               a.email, a.is_active as accountStatus, a.last_login as lastLogin, a.created_at as createdAt,
               m.first_name + ' ' + m.last_name as createdByName
        FROM USER_MASTER a
        WHERE a.role IN ('admin', 'superadmin')
      `
      
      const params = []
      let paramCount = 1
      
      if (accessLevel) {
        query += ` AND a.role = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: accessLevel })
        paramCount++
      }
      
      if (status) {
        query += ` AND a.is_active = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: status === 'active' ? 1 : 0 })
        paramCount++
      }
      
      if (search) {
        query += ` AND (a.first_name LIKE @param${paramCount} OR a.last_name LIKE @param${paramCount} OR a.employee_id LIKE @param${paramCount} OR a.email LIKE @param${paramCount})`
        params.push({ name: `param${paramCount}`, value: `%${search}%` })
        paramCount++
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      
      query += ` ORDER BY a.created_at DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().query(countQuery)
      ])
      
      res.json({
        admins: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching admins:', error)
      res.status(500).json({ error: 'Failed to fetch admins' })
    }
  }
)

router.post('/',
  auth,
  rbac(['superadmin']),
  createAdminValidation,
  validateRequest,
  async (req, res) => {
    try {
      const { firstName, lastName, email, password, employeeId, permissions, accessLevel } = req.body
      const pool = await getDbConnection()
      
      const existingUser = await pool.request()
        .input('email', email)
        .input('employeeId', employeeId)
        .query('SELECT user_id FROM USER_MASTER WHERE email = @email OR employeeId = @employeeId')
      
      if (existingUser.recordset.length > 0) {
        return res.status(400).json({ error: 'User with this email or employee ID already exists' })
      }
      
      const hashedPassword = await bcrypt.hash(password, 12)
      
      const result = await pool.request()
        .input('firstName', firstName)
        .input('lastName', lastName)
        .input('email', email)
        .input('password', hashedPassword)
        .input('employeeId', employeeId)
        .input('role', accessLevel || 'admin')
        .input('permissions', JSON.stringify(permissions || []))
        .input('status', 'active')
        .input('createdBy', req.user.id)
        .input('createdAt', new Date())
        .input('registrationType', 'admin-created')
        .input('userStatus', 'active')
        .query(`
          INSERT INTO USER_MASTER (
            first_name, last_name, email, password_hash, employee_id,
            role, is_active, registration_type, user_status, created_at
          )
          OUTPUT INSERTED.user_id
          VALUES (
            @firstName, @lastName, @email, @password, @employeeId,
            @role, 1, @registrationType, @userStatus, @createdAt
          )
        `)
      
      res.status(201).json({ 
        message: 'Admin created successfully',
        adminId: result.recordset[0].user_id
      })
    } catch (error) {
      console.error('Error creating admin:', error)
      res.status(500).json({ error: 'Failed to create admin' })
    }
  }
)

router.get('/:id',
  auth,
  rbac(['superadmin']),
  [param('id').isInt().withMessage('Valid admin ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      const result = await pool.request()
        .input('id', id)
        .query(`
          SELECT a.*, 
                 a.email, a.is_active as accountStatus, a.last_login as lastLogin, a.created_at as createdAt,
                 m.first_name + ' ' + m.last_name as createdByName
          FROM USER_MASTER a
            WHERE a.user_id = @id AND a.role IN ('admin', 'superadmin')
        `)
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Admin not found' })
      }
      
      const activityLogsResult = await pool.request()
        .input('adminId', id)
        .query(`
          SELECT TOP 10 *
          FROM user_activity_logs
          WHERE user_id = @adminId
          ORDER BY created_at DESC
        `)
      
      const admin = result.recordset[0]
      admin.recentActivity = activityLogsResult.recordset
      
      res.json(admin)
    } catch (error) {
      console.error('Error fetching admin:', error)
      res.status(500).json({ error: 'Failed to fetch admin' })
    }
  }
)

router.put('/:id',
  auth,
  rbac(['superadmin']),
  [param('id').isInt().withMessage('Valid admin ID required'), ...adminValidation],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { firstName, lastName, permissions, accessLevel, status } = req.body
      
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role IN (\'admin\', \'superadmin\')')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Admin not found' })
      }
      
      const result = await pool.request()
        .input('id', id)
        .input('firstName', firstName)
        .input('lastName', lastName)
        .input('role', accessLevel)
        .input('isActive', status === 'active' ? 1 : 0)
        .input('updatedAt', new Date())
        .query(`
          UPDATE USER_MASTER SET 
            first_name = @firstName,
            last_name = @lastName,
            role = @role,
            is_active = @isActive,
            updated_at = @updatedAt
          WHERE user_id = @id
        `)
      
      res.json({ message: 'Admin updated successfully' })
    } catch (error) {
      console.error('Error updating admin:', error)
      res.status(500).json({ error: 'Failed to update admin' })
    }
  }
)

router.post('/:id/reset-password',
  auth,
  rbac(['superadmin']),
  [
    param('id').isInt().withMessage('Valid admin ID required'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number and one special character')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { newPassword } = req.body
      
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role IN (\'admin\', \'superadmin\')')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Admin not found' })
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 12)
      
      await pool.request()
        .input('id', id)
        .input('password', hashedPassword)
        .input('updatedAt', new Date())
        .query(`
          UPDATE USER_MASTER SET 
            password_hash = @password,
            updated_at = @updatedAt
          WHERE user_id = @id
        `)
      
      res.json({ message: 'Password reset successfully' })
    } catch (error) {
      console.error('Error resetting password:', error)
      res.status(500).json({ error: 'Failed to reset password' })
    }
  }
)

router.get('/:id/activity-logs',
  auth,
  rbac(['superadmin']),
  [param('id').isInt().withMessage('Valid admin ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { action, page = 1, limit = 50 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      
      let query = `
        SELECT *
        FROM user_activity_logs
        WHERE user_id = @adminId
      `
      
      if (action) {
        query += ` AND activity_type = @action`
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      query += ` ORDER BY created_at DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request().input('adminId', id)
      if (action) request.input('action', action)
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().input('adminId', id).query(countQuery)
      ])
      
      res.json({
        logs: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching activity logs:', error)
      res.status(500).json({ error: 'Failed to fetch activity logs' })
    }
  }
)

router.delete('/:id',
  auth,
  rbac(['superadmin']),
  [param('id').isInt().withMessage('Valid admin ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      if (id == req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' })
      }
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id, role FROM USER_MASTER WHERE user_id = @id AND role IN (\'admin\', \'superadmin\')')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Admin not found' })
      }
      
      if (checkResult.recordset[0].role === 'superadmin') {
        const superadminCount = await pool.request()
          .query('SELECT COUNT(*) as count FROM USER_MASTER WHERE role = \'superadmin\' AND is_active = 1')
        
        if (superadminCount.recordset[0].count <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last active superadmin' })
        }
      }
      
      await pool.request()
        .input('id', id)
        .input('updatedAt', new Date())
        .query('UPDATE USER_MASTER SET is_active = 0, updated_at = @updatedAt WHERE user_id = @id')
      
      res.json({ message: 'Admin deactivated successfully' })
    } catch (error) {
      console.error('Error deactivating admin:', error)
      res.status(500).json({ error: 'Failed to deactivate admin' })
    }
  }
)

module.exports = router