const express = require('express')
const router = express.Router()
const { auth } = require('../../middleware/auth')
const { rbac } = require('../../middleware/permissions')
const { validateRequest } = require('../../middleware/validation')
const { body, param, query } = require('express-validator')
const { getDbConnection } = require('../../config/database')

const coordinatorValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('departmentId').isInt().withMessage('Valid department ID required'),
  body('managerId').optional().isInt().withMessage('Valid manager ID required'),
  body('specialization').optional().isString().withMessage('Specialization must be a string'),
  body('certifications').optional().isArray().withMessage('Certifications must be an array')
]

router.get('/', 
  auth,
  rbac(['admin', 'superadmin', 'department_head']),
  async (req, res) => {
    try {
      const { departmentId, specialization, status, search, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      let query = `
        SELECT c.*, 
               u.email, u.status as accountStatus, u.lastLogin,
               d.name as departmentName, d.code as departmentCode,
               m.firstName + ' ' + m.lastName as managerName
        FROM users c
        LEFT JOIN users u ON c.id = u.id
        LEFT JOIN departments d ON c.departmentId = d.id
        LEFT JOIN users m ON c.managerId = m.id
        WHERE u.role IN ('coordinator', 'department_coordinator')
      `
      
      const params = []
      let paramCount = 1
      
      if (departmentId) {
        query += ` AND c.departmentId = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: departmentId })
        paramCount++
      }
      
      if (specialization) {
        query += ` AND c.specialization LIKE @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: `%${specialization}%` })
        paramCount++
      }
      
      if (status) {
        query += ` AND c.status = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: status })
        paramCount++
      }
      
      if (search) {
        query += ` AND (c.firstName LIKE @param${paramCount} OR c.lastName LIKE @param${paramCount} OR c.employeeId LIKE @param${paramCount})`
        params.push({ name: `param${paramCount}`, value: `%${search}%` })
        paramCount++
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      
      query += ` ORDER BY c.firstName, c.lastName OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().query(countQuery)
      ])
      
      res.json({
        coordinators: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching coordinators:', error)
      res.status(500).json({ error: 'Failed to fetch coordinators' })
    }
  }
)

router.get('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator']),
  [param('id').isInt().withMessage('Valid coordinator ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      const result = await pool.request()
        .input('id', id)
        .query(`
          SELECT c.*, 
                 u.email, u.status as accountStatus, u.lastLogin, u.createdAt,
                 d.name as departmentName, d.code as departmentCode,
                 m.firstName + ' ' + m.lastName as managerName
          FROM users c
          LEFT JOIN users u ON c.id = u.id
          LEFT JOIN departments d ON c.departmentId = d.id
          LEFT JOIN users m ON c.managerId = m.id
          WHERE c.id = @id AND u.role IN ('coordinator', 'department_coordinator')
        `)
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Coordinator not found' })
      }
      
      const assignedAssetsResult = await pool.request()
        .input('coordinatorId', id)
        .query(`
          SELECT COUNT(*) as assignedAssets
          FROM assets 
          WHERE coordinatorId = @coordinatorId AND status = 'active'
        `)
      
      const coordinator = result.recordset[0]
      coordinator.assignedAssets = assignedAssetsResult.recordset[0].assignedAssets
      
      res.json(coordinator)
    } catch (error) {
      console.error('Error fetching coordinator:', error)
      res.status(500).json({ error: 'Failed to fetch coordinator' })
    }
  }
)

router.put('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head']),
  [param('id').isInt().withMessage('Valid coordinator ID required'), ...coordinatorValidation],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { firstName, lastName, departmentId, managerId, specialization, certifications, status } = req.body
      
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role IN (\'coordinator\', \'department_coordinator\')')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Coordinator not found' })
      }
      
      const result = await pool.request()
        .input('id', id)
        .input('firstName', firstName)
        .input('lastName', lastName)
        .input('departmentId', departmentId)
        .input('managerId', managerId || null)
        .input('specialization', specialization || null)
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
            certifications = @certifications,
            status = @status,
            updatedAt = @updatedAt
          WHERE user_id = @id
        `)
      
      res.json({ message: 'Coordinator updated successfully' })
    } catch (error) {
      console.error('Error updating coordinator:', error)
      res.status(500).json({ error: 'Failed to update coordinator' })
    }
  }
)

router.get('/:id/assigned-assets',
  auth,
  rbac(['admin', 'superadmin', 'department_head', 'coordinator']),
  [param('id').isInt().withMessage('Valid coordinator ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { status, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      
      let query = `
        SELECT a.*, 
               p.name as productName, p.model as productModel,
               c.name as categoryName,
               l.name as locationName
        FROM assets a
        LEFT JOIN products p ON a.productId = p.id
        LEFT JOIN categories c ON p.categoryId = c.id
        LEFT JOIN locations l ON a.locationId = l.id
        WHERE a.coordinatorId = @coordinatorId
      `
      
      if (status) {
        query += ` AND a.status = @status`
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      query += ` ORDER BY a.createdAt DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request().input('coordinatorId', id)
      if (status) request.input('status', status)
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().input('coordinatorId', id).query(countQuery)
      ])
      
      res.json({
        assets: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching coordinator assets:', error)
      res.status(500).json({ error: 'Failed to fetch coordinator assets' })
    }
  }
)

module.exports = router