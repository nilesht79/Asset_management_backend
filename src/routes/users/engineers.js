const express = require('express')
const router = express.Router()
const { auth } = require('../../middleware/auth')
const { rbac } = require('../../middleware/permissions')
const { validateRequest } = require('../../middleware/validation')
const { body, param, query } = require('express-validator')
const { getDbConnection } = require('../../config/database')

const engineerValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('departmentId').isInt().withMessage('Valid department ID required'),
  body('managerId').optional().isInt().withMessage('Valid manager ID required'),
  body('specialization').optional().isString().withMessage('Specialization must be a string'),
  body('skillLevel').optional().isIn(['junior', 'mid', 'senior', 'lead']).withMessage('Valid skill level required'),
  body('certifications').optional().isArray().withMessage('Certifications must be an array')
]

router.get('/', 
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator']),
  async (req, res) => {
    try {
      const { departmentId, specialization, skillLevel, status, search, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      let query = `
        SELECT e.*, 
               e.email, e.is_active as accountStatus, e.last_login as lastLogin,
               d.department_name as departmentName, d.department_id as departmentCode,
               m.first_name + ' ' + m.last_name as managerName
        FROM USER_MASTER e
        LEFT JOIN DEPARTMENT_MASTER d ON e.department_id = d.department_id
        WHERE e.role = 'engineer'
      `
      
      const params = []
      let paramCount = 1
      
      if (departmentId) {
        query += ` AND e.department_id = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: departmentId })
        paramCount++
      }
      
      if (specialization) {
        query += ` AND e.specialization LIKE @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: `%${specialization}%` })
        paramCount++
      }
      
      if (skillLevel) {
        query += ` AND e.skillLevel = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: skillLevel })
        paramCount++
      }
      
      if (status) {
        query += ` AND e.is_active = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: status === 'active' ? 1 : 0 })
        paramCount++
      }
      
      if (search) {
        query += ` AND (e.first_name LIKE @param${paramCount} OR e.last_name LIKE @param${paramCount} OR e.employee_id LIKE @param${paramCount})`
        params.push({ name: `param${paramCount}`, value: `%${search}%` })
        paramCount++
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      
      query += ` ORDER BY e.first_name, e.last_name OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().query(countQuery)
      ])
      
      res.json({
        engineers: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching engineers:', error)
      res.status(500).json({ error: 'Failed to fetch engineers' })
    }
  }
)

router.get('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator', 'engineer']),
  [param('id').isInt().withMessage('Valid engineer ID required')],
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
          WHERE e.id = @id AND u.role = 'engineer'
        `)
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Engineer not found' })
      }
      
      const ticketStatsResult = await pool.request()
        .input('engineerId', id)
        .query(`
          SELECT 
            COUNT(*) as totalTickets,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openTickets,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTickets,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedTickets,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closedTickets
          FROM tickets 
          WHERE assignedTo = @engineerId
        `)
      
      const engineer = result.recordset[0]
      engineer.ticketStats = ticketStatsResult.recordset[0]
      
      res.json(engineer)
    } catch (error) {
      console.error('Error fetching engineer:', error)
      res.status(500).json({ error: 'Failed to fetch engineer' })
    }
  }
)

router.put('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator']),
  [param('id').isInt().withMessage('Valid engineer ID required'), ...engineerValidation],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { firstName, lastName, departmentId, managerId, specialization, skillLevel, certifications, status } = req.body
      
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role = \'engineer\'')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Engineer not found' })
      }
      
      const result = await pool.request()
        .input('id', id)
        .input('firstName', firstName)
        .input('lastName', lastName)
        .input('departmentId', departmentId)
        .input('managerId', managerId || null)
        .input('specialization', specialization || null)
        .input('skillLevel', skillLevel || null)
        .input('certifications', JSON.stringify(certifications || []))
        .input('status', status)
        .input('updatedAt', new Date())
        .query(`
          UPDATE USER_MASTER SET 
            firstName = @firstName,
            lastName = @lastName,
            departmentId = @departmentId,
            managerId = @managerId,
            specialization = @specialization,
            skillLevel = @skillLevel,
            certifications = @certifications,
            status = @status,
            updatedAt = @updatedAt
          WHERE user_id = @id
        `)
      
      res.json({ message: 'Engineer updated successfully' })
    } catch (error) {
      console.error('Error updating engineer:', error)
      res.status(500).json({ error: 'Failed to update engineer' })
    }
  }
)

router.get('/:id/tickets',
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator', 'engineer']),
  [param('id').isInt().withMessage('Valid engineer ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { status, priority, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      
      let query = `
        SELECT t.*, 
               u.firstName + ' ' + u.lastName as reportedByName,
               a.serialNumber as assetSerialNumber,
               p.name as productName
        FROM tickets t
        LEFT JOIN users u ON t.reportedBy = u.id
        LEFT JOIN assets a ON t.assetId = a.id
        LEFT JOIN products p ON a.productId = p.id
        WHERE t.assignedTo = @engineerId
      `
      
      const params = [{ name: 'engineerId', value: id }]
      
      if (status) {
        query += ` AND t.status = @status`
        params.push({ name: 'status', value: status })
      }
      
      if (priority) {
        query += ` AND t.priority = @priority`
        params.push({ name: 'priority', value: priority })
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      query += ` ORDER BY t.createdAt DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().input('engineerId', id).query(countQuery)
      ])
      
      res.json({
        tickets: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching engineer tickets:', error)
      res.status(500).json({ error: 'Failed to fetch engineer tickets' })
    }
  }
)

router.get('/available',
  auth,
  rbac(['admin', 'superadmin', 'coordinator']),
  async (req, res) => {
    try {
      const { specialization, skillLevel } = req.query
      const pool = await getDbConnection()
      
      let query = `
        SELECT e.id, e.firstName, e.lastName, e.specialization, e.skillLevel,
               COUNT(t.id) as activeTickets
        FROM users e
        LEFT JOIN tickets t ON e.id = t.assignedTo AND t.status IN ('open', 'in_progress')
        WHERE e.role = 'engineer' AND e.status = 'active'
      `
      
      const params = []
      
      if (specialization) {
        query += ` AND e.specialization LIKE @specialization`
        params.push({ name: 'specialization', value: `%${specialization}%` })
      }
      
      if (skillLevel) {
        query += ` AND e.skillLevel = @skillLevel`
        params.push({ name: 'skillLevel', value: skillLevel })
      }
      
      query += ` GROUP BY e.id, e.firstName, e.lastName, e.specialization, e.skillLevel ORDER BY activeTickets ASC, e.firstName`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const result = await request.query(query)
      res.json(result.recordset)
    } catch (error) {
      console.error('Error fetching available engineers:', error)
      res.status(500).json({ error: 'Failed to fetch available engineers' })
    }
  }
)

module.exports = router