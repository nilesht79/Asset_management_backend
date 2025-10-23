const express = require('express')
const router = express.Router()
const { authenticateToken } = require('../../middleware/auth')
const { requireRole } = require('../../middleware/permissions')
const { asyncHandler } = require('../../middleware/error-handler')
const { connectDB, sql } = require('../../config/database')

// GET /available - Get available engineers for assignment
router.get('/available',
  authenticateToken,
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB()
    const { department_id } = req.query

    // Build query with optional department filter
    let whereClause = 'role = \'engineer\' AND is_active = 1'
    const params = []

    if (department_id) {
      whereClause += ' AND department_id = @departmentId'
      params.push({ name: 'departmentId', type: sql.UniqueIdentifier, value: department_id })
    }

    const request = pool.request()
    params.forEach(param => request.input(param.name, param.type, param.value))

    const result = await request.query(`
      SELECT
        user_id,
        first_name as firstName,
        last_name as lastName,
        email,
        employee_id,
        department_id
      FROM USER_MASTER
      WHERE ${whereClause}
      ORDER BY first_name, last_name
    `)

    res.json({
      success: true,
      data: {
        engineers: result.recordset
      }
    })
  })
)

module.exports = router
