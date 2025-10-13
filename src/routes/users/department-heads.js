const express = require('express')
const router = express.Router()
const { auth } = require('../../middleware/auth')
const { rbac } = require('../../middleware/permissions')
const { validateRequest } = require('../../middleware/validation')
const { body, param, query } = require('express-validator')
const { getDbConnection } = require('../../config/database')

const departmentHeadValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('departmentId').isInt().withMessage('Valid department ID required'),
  body('managerId').optional().isInt().withMessage('Valid manager ID required'),
  body('yearsOfExperience').optional().isInt({ min: 0 }).withMessage('Years of experience must be a positive number'),
  body('qualifications').optional().isArray().withMessage('Qualifications must be an array')
]

router.get('/', 
  auth,
  rbac(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { departmentId, status, search, page = 1, limit = 10 } = req.query
      const offset = (page - 1) * limit
      
      const pool = await getDbConnection()
      let query = `
        SELECT dh.*, 
               u.email, u.status as accountStatus, u.lastLogin,
               d.name as departmentName, d.code as departmentCode,
               m.firstName + ' ' + m.lastName as managerName
        FROM users dh
        LEFT JOIN users u ON dh.id = u.id
        LEFT JOIN departments d ON dh.departmentId = d.id
        LEFT JOIN users m ON dh.managerId = m.id
        WHERE u.role = 'department_head'
      `
      
      const params = []
      let paramCount = 1
      
      if (departmentId) {
        query += ` AND dh.departmentId = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: departmentId })
        paramCount++
      }
      
      if (status) {
        query += ` AND dh.status = @param${paramCount}`
        params.push({ name: `param${paramCount}`, value: status })
        paramCount++
      }
      
      if (search) {
        query += ` AND (dh.firstName LIKE @param${paramCount} OR dh.lastName LIKE @param${paramCount} OR dh.employeeId LIKE @param${paramCount})`
        params.push({ name: `param${paramCount}`, value: `%${search}%` })
        paramCount++
      }
      
      const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      
      query += ` ORDER BY dh.firstName, dh.lastName OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      
      const request = pool.request()
      params.forEach(param => {
        request.input(param.name, param.value)
      })
      
      const [result, countResult] = await Promise.all([
        request.query(query),
        pool.request().query(countQuery)
      ])
      
      res.json({
        departmentHeads: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      })
    } catch (error) {
      console.error('Error fetching department heads:', error)
      res.status(500).json({ error: 'Failed to fetch department heads' })
    }
  }
)

router.get('/:id',
  auth,
  rbac(['admin', 'superadmin', 'department_head']),
  [param('id').isInt().withMessage('Valid department head ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      const result = await pool.request()
        .input('id', id)
        .query(`
          SELECT dh.*, 
                 u.email, u.status as accountStatus, u.lastLogin, u.createdAt,
                 d.name as departmentName, d.code as departmentCode,
                 m.firstName + ' ' + m.lastName as managerName
          FROM users dh
          LEFT JOIN users u ON dh.id = u.id
          LEFT JOIN departments d ON dh.departmentId = d.id
          LEFT JOIN users m ON dh.managerId = m.id
          WHERE dh.id = @id AND u.role = 'department_head'
        `)
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Department head not found' })
      }
      
      const departmentStatsResult = await pool.request()
        .input('departmentId', result.recordset[0].departmentId)
        .query(`
          SELECT 
            COUNT(DISTINCT u.id) as totalEmployees,
            COUNT(DISTINCT a.id) as totalAssets,
            COUNT(DISTINCT t.id) as totalTickets,
            COUNT(DISTINCT CASE WHEN t.status = 'open' THEN t.id END) as openTickets
          FROM departments d
          LEFT JOIN users u ON d.id = u.departmentId AND u.role != 'department_head'
          LEFT JOIN assets a ON d.id = a.departmentId
          LEFT JOIN tickets t ON d.id = t.departmentId
          WHERE d.id = @departmentId
        `)
      
      const departmentHead = result.recordset[0]
      departmentHead.departmentStats = departmentStatsResult.recordset[0]
      
      res.json(departmentHead)
    } catch (error) {
      console.error('Error fetching department head:', error)
      res.status(500).json({ error: 'Failed to fetch department head' })
    }
  }
)

router.put('/:id',
  auth,
  rbac(['admin', 'superadmin']),
  [param('id').isInt().withMessage('Valid department head ID required'), ...departmentHeadValidation],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { firstName, lastName, departmentId, managerId, yearsOfExperience, qualifications, status } = req.body
      
      const pool = await getDbConnection()
      
      const checkResult = await pool.request()
        .input('id', id)
        .query('SELECT user_id FROM USER_MASTER WHERE user_id = @id AND role = \'department_head\'')
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Department head not found' })
      }
      
      const result = await pool.request()
        .input('id', id)
        .input('firstName', firstName)
        .input('lastName', lastName)
        .input('departmentId', departmentId)
        .input('managerId', managerId || null)
        .input('yearsOfExperience', yearsOfExperience || null)
        .input('qualifications', JSON.stringify(qualifications || []))
        .input('status', status)
        .input('updatedAt', new Date())
        .query(`
          UPDATE USER_MASTER SET 
            firstName = @firstName,
            lastName = @lastName,
            departmentId = @departmentId,
            managerId = @managerId,
            yearsOfExperience = @yearsOfExperience,
            qualifications = @qualifications,
            status = @status,
            updatedAt = @updatedAt
          WHERE user_id = @id
        `)
      
      res.json({ message: 'Department head updated successfully' })
    } catch (error) {
      console.error('Error updating department head:', error)
      res.status(500).json({ error: 'Failed to update department head' })
    }
  }
)

router.get('/:id/department-overview',
  auth,
  rbac(['admin', 'superadmin', 'department_head']),
  [param('id').isInt().withMessage('Valid department head ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const pool = await getDbConnection()
      
      const departmentResult = await pool.request()
        .input('id', id)
        .query(`
          SELECT d.id as departmentId, d.name as departmentName
          FROM users dh
          JOIN departments d ON dh.departmentId = d.id
          WHERE dh.id = @id AND dh.role = 'department_head'
        `)
      
      if (departmentResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Department head not found' })
      }
      
      const { departmentId } = departmentResult.recordset[0]
      
      const [employeesResult, assetsResult, ticketsResult, budgetResult] = await Promise.all([
        pool.request()
          .input('departmentId', departmentId)
          .query(`
            SELECT 
              COUNT(*) as totalEmployees,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeEmployees,
              SUM(CASE WHEN role = 'coordinator' THEN 1 ELSE 0 END) as coordinators,
              SUM(CASE WHEN role = 'engineer' THEN 1 ELSE 0 END) as engineers
            FROM users 
            WHERE departmentId = @departmentId AND role != 'department_head'
          `),
        pool.request()
          .input('departmentId', departmentId)
          .query(`
            SELECT 
              COUNT(*) as totalAssets,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeAssets,
              SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenanceAssets,
              SUM(CASE WHEN status = 'retired' THEN 1 ELSE 0 END) as retiredAssets
            FROM assets 
            WHERE departmentId = @departmentId
          `),
        pool.request()
          .input('departmentId', departmentId)
          .query(`
            SELECT 
              COUNT(*) as totalTickets,
              SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openTickets,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTickets,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedTickets,
              SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as highPriorityTickets
            FROM tickets 
            WHERE departmentId = @departmentId
          `),
        pool.request()
          .input('departmentId', departmentId)
          .query(`
            SELECT 
              ISNULL(SUM(purchasePrice), 0) as totalAssetValue,
              ISNULL(AVG(purchasePrice), 0) as avgAssetValue
            FROM assets 
            WHERE departmentId = @departmentId AND status != 'retired'
          `)
      ])
      
      const overview = {
        department: departmentResult.recordset[0],
        employees: employeesResult.recordset[0],
        assets: assetsResult.recordset[0],
        tickets: ticketsResult.recordset[0],
        budget: budgetResult.recordset[0]
      }
      
      res.json(overview)
    } catch (error) {
      console.error('Error fetching department overview:', error)
      res.status(500).json({ error: 'Failed to fetch department overview' })
    }
  }
)

router.get('/:id/team-performance',
  auth,
  rbac(['admin', 'superadmin', 'department_head']),
  [param('id').isInt().withMessage('Valid department head ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { id } = req.params
      const { period = 'month' } = req.query // month, quarter, year
      const pool = await getDbConnection()
      
      let dateFilter = ''
      switch (period) {
        case 'week':
          dateFilter = 'AND t.createdAt >= DATEADD(week, -1, GETDATE())'
          break
        case 'month':
          dateFilter = 'AND t.createdAt >= DATEADD(month, -1, GETDATE())'
          break
        case 'quarter':
          dateFilter = 'AND t.createdAt >= DATEADD(quarter, -1, GETDATE())'
          break
        case 'year':
          dateFilter = 'AND t.createdAt >= DATEADD(year, -1, GETDATE())'
          break
      }
      
      const departmentResult = await pool.request()
        .input('id', id)
        .query(`
          SELECT departmentId 
          FROM users 
          WHERE user_id = @id AND role = 'department_head'
        `)
      
      if (departmentResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Department head not found' })
      }
      
      const { departmentId } = departmentResult.recordset[0]
      
      const performanceResult = await pool.request()
        .input('departmentId', departmentId)
        .query(`
          SELECT 
            e.id,
            e.firstName + ' ' + e.lastName as name,
            e.role,
            COUNT(t.id) as totalTickets,
            SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) as resolvedTickets,
            SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) as closedTickets,
            AVG(CASE WHEN t.resolvedAt IS NOT NULL 
                THEN DATEDIFF(hour, t.createdAt, t.resolvedAt) 
                ELSE NULL END) as avgResolutionTime
          FROM users e
          LEFT JOIN tickets t ON e.id = t.assignedTo ${dateFilter}
          WHERE e.departmentId = @departmentId 
            AND e.role IN ('engineer', 'coordinator')
            AND e.status = 'active'
          GROUP BY e.id, e.firstName, e.lastName, e.role
          ORDER BY resolvedTickets DESC, avgResolutionTime ASC
        `)
      
      res.json(performanceResult.recordset)
    } catch (error) {
      console.error('Error fetching team performance:', error)
      res.status(500).json({ error: 'Failed to fetch team performance' })
    }
  }
)

module.exports = router