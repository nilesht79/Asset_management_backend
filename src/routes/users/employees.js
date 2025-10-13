const express = require('express')
const router = express.Router()
const { auth } = require('../../middleware/auth')
const { rbac } = require('../../middleware/permissions')
const { validateRequest } = require('../../middleware/validation')
const { body, param, query } = require('express-validator')
const { getDbConnection } = require('../../config/database')

const employeeValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('departmentId').isInt().withMessage('Valid department ID required'),
  body('managerId').optional().isInt().withMessage('Valid manager ID required'),
  body('joiningDate').isISO8601().withMessage('Valid joining date required'),
  body('status').isIn(['active', 'inactive', 'terminated']).withMessage('Valid status required')
]

router.get('/', 
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator']),
  async (req, res) => {
    try {
      const { departmentId, status, search, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      let query = `
        SELECT e.*, 
               u.email, u.status as accountStatus, u.lastLogin,
               d.name as departmentName, d.code as departmentCode,
               m.firstName + ' ' + m.lastName as managerName
        FROM users e
        LEFT JOIN users u ON e.id = u.id
        LEFT JOIN departments d ON e.departmentId = d.id
        LEFT JOIN users m ON e.managerId = m.id
        WHERE u.role = 'employee'
      `
      
      const params = []
      let paramCount = 1
      
      if (departmentId) {
        query += ` AND e.departmentId = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: departmentId })
        paramCount++
      }
      
      if (status) {
        query += ` AND e.status = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: status })
        paramCount++
      }
      
      if (search) {
        query += ` AND (e.firstName LIKE @param${paramCount} OR e.lastName LIKE @param${paramCount} OR e.employeeId LIKE @param${paramCount})`
        params.push({ name: `param${paramCount}`, value: `%${search}%` })
        paramCount++
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      
      query += ` ORDER BY e.firstName, e.lastName OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().query(countQuery)
      ])
      
      res.json({
        employees: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching employees:', error)
      res.status(500).json({ error: 'Failed to fetch employees' })
    }
  }
)

router.get('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator']),
  [param('id').isInt().withMessage('Valid employee ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      const result = await pool.request()
        .input('id', id)
        .query(`
          SELECT e.*, 
                 u.email, u.status as accountStatus, u.lastLogin, u.createdAt,
                 d.name as departmentName, d.code as departmentCode,
                 m.firstName + ' ' + m.lastName as managerName
          FROM users e
          LEFT JOIN users u ON e.id = u.id
          LEFT JOIN departments d ON e.departmentId = d.id
          LEFT JOIN users m ON e.managerId = m.id
          WHERE e.id = @id AND u.role = 'employee'
        `)
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Employee not found' })
      }
      
      res.json(result.recordset[0])
    } catch (error) {
      console.error('Error fetching employee:', error)
      res.status(500).json({ error: 'Failed to fetch employee' })
    }
  }
)

router.put('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head']),
  [param('id').isInt().withMessage('Valid employee ID required'), ...employeeValidation],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { firstName, lastName, departmentId, managerId, joiningDate, status } = req.body
      
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role = \'employee\'')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Employee not found' })
      }
      
      const result = await pool.request()
        .input('id', id)
        .input('firstName', firstName)
        .input('lastName', lastName)
        .input('departmentId', departmentId)
        .input('managerId', managerId || null)
        .input('joiningDate', joiningDate)
        .input('status', status)
        .input('updatedAt', new Date())
        .query(`
          UPDATE USER_MASTER SET 
            firstName = @firstName,
            lastName = @lastName,
            departmentId = @departmentId,
            managerId = @managerId,
            joiningDate = @joiningDate,
            status = @status,
            updatedAt = @updatedAt
          WHERE user_id = @id
        `)
      
      res.json({ message: 'Employee updated successfully' })
    } catch (error) {
      console.error('Error updating employee:', error)
      res.status(500).json({ error: 'Failed to update employee' })
    }
  }
)

router.delete('/:id',
  auth,
  rbac(['admin', 'superadmin']),
  [param('id').isInt().withMessage('Valid employee ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role = \'employee\'')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Employee not found' })
      }
      
      await pool.request()
        .input('id', id)
        .input('updatedAt', new Date())
        .query('UPDATE USER_MASTER SET status = \'terminated\', updatedAt = @updatedAt WHERE user_id = @id')
      
      res.json({ message: 'Employee terminated successfully' })
    } catch (error) {
      console.error('Error terminating employee:', error)
      res.status(500).json({ error: 'Failed to terminate employee' })
    }
  }
)

module.exports = router