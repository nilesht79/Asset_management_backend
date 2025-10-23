const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validatePagination } = require('../../middleware/validation');
const { requireDynamicPermission, requireRole } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// GET /boards - List all boards with pagination and search
router.get('/',
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, is_active } = req.query;

    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (b.board_name LIKE @search OR b.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (is_active !== undefined) {
      whereClause += ' AND b.is_active = @is_active';
      params.push({ name: 'is_active', type: sql.Bit, value: is_active === 'true' ? 1 : 0 });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM BOARD_MASTER b
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get paginated results with department count
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['board_name', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `b.${sortBy}` : 'b.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT
        b.board_id,
        b.board_name,
        CAST(b.description AS NVARCHAR(MAX)) as description,
        b.is_active,
        b.created_at,
        b.updated_at,
        COUNT(bd.department_id) as department_count
      FROM BOARD_MASTER b
      LEFT JOIN BOARD_DEPARTMENTS bd ON b.board_id = bd.board_id
      WHERE ${whereClause}
      GROUP BY b.board_id, b.board_name, CAST(b.description AS NVARCHAR(MAX)), b.is_active, b.created_at, b.updated_at
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    const boards = result.recordset.map(board => ({
      id: board.board_id,
      name: board.board_name,
      description: board.description,
      isActive: board.is_active,
      departmentCount: board.department_count,
      createdAt: board.created_at,
      updatedAt: board.updated_at
    }));

    sendSuccess(res, {
      boards,
      pagination
    }, 'Boards retrieved successfully');
  })
);

// GET /boards/:id - Get single board with departments
router.get('/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Validate UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return sendError(res, 'Invalid board ID format', 400);
    }

    const pool = await connectDB();

    // Get board details
    const boardResult = await pool.request()
      .input('board_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT board_id, board_name, description, is_active, created_at, updated_at
        FROM BOARD_MASTER
        WHERE board_id = @board_id
      `);

    if (boardResult.recordset.length === 0) {
      return sendNotFound(res, 'Board not found');
    }

    const board = boardResult.recordset[0];

    // Get assigned departments
    const deptResult = await pool.request()
      .input('board_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          d.department_id,
          d.department_name,
          d.description,
          bd.assigned_at
        FROM BOARD_DEPARTMENTS bd
        INNER JOIN DEPARTMENT_MASTER d ON bd.department_id = d.department_id
        WHERE bd.board_id = @board_id
        ORDER BY d.department_name
      `);

    const departments = deptResult.recordset.map(dept => ({
      id: dept.department_id,
      name: dept.department_name,
      description: dept.description,
      assignedAt: dept.assigned_at
    }));

    sendSuccess(res, {
      board: {
        id: board.board_id,
        name: board.board_name,
        description: board.description,
        isActive: board.is_active,
        createdAt: board.created_at,
        updatedAt: board.updated_at,
        departments
      }
    }, 'Board retrieved successfully');
  })
);

// POST /boards - Create new board
router.post('/',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { name, description, departmentIds = [] } = req.body;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return sendError(res, 'Board name is required and must be at least 2 characters', 400);
    }

    if (name.length > 100) {
      return sendError(res, 'Board name cannot exceed 100 characters', 400);
    }

    const pool = await connectDB();

    // Check if board name already exists
    const existingBoard = await pool.request()
      .input('board_name', sql.VarChar(100), name)
      .query('SELECT board_id FROM BOARD_MASTER WHERE board_name = @board_name');

    if (existingBoard.recordset.length > 0) {
      return sendConflict(res, 'Board name already exists');
    }

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const boardId = uuidv4();

      // Insert board
      await transaction.request()
        .input('board_id', sql.UniqueIdentifier, boardId)
        .input('board_name', sql.VarChar(100), name)
        .input('description', sql.Text, description || null)
        .query(`
          INSERT INTO BOARD_MASTER (board_id, board_name, description)
          VALUES (@board_id, @board_name, @description)
        `);

      // Insert department assignments if provided
      if (departmentIds && departmentIds.length > 0) {
        for (const deptId of departmentIds) {
          await transaction.request()
            .input('board_department_id', sql.UniqueIdentifier, uuidv4())
            .input('board_id', sql.UniqueIdentifier, boardId)
            .input('department_id', sql.UniqueIdentifier, deptId)
            .query(`
              INSERT INTO BOARD_DEPARTMENTS (board_department_id, board_id, department_id)
              VALUES (@board_department_id, @board_id, @department_id)
            `);
        }
      }

      await transaction.commit();

      sendCreated(res, {
        board: {
          id: boardId,
          name,
          description,
          departmentCount: departmentIds.length
        }
      }, 'Board created successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// PUT /boards/:id - Update board
router.put('/:id',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, isActive, departmentIds } = req.body;

    // Validate UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return sendError(res, 'Invalid board ID format', 400);
    }

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return sendError(res, 'Board name is required and must be at least 2 characters', 400);
    }

    if (name.length > 100) {
      return sendError(res, 'Board name cannot exceed 100 characters', 400);
    }

    const pool = await connectDB();

    // Check if board exists
    const existingBoard = await pool.request()
      .input('board_id', sql.UniqueIdentifier, id)
      .query('SELECT board_id FROM BOARD_MASTER WHERE board_id = @board_id');

    if (existingBoard.recordset.length === 0) {
      return sendNotFound(res, 'Board not found');
    }

    // Check if name is taken by another board
    const nameTaken = await pool.request()
      .input('board_id', sql.UniqueIdentifier, id)
      .input('board_name', sql.VarChar(100), name)
      .query('SELECT board_id FROM BOARD_MASTER WHERE board_name = @board_name AND board_id != @board_id');

    if (nameTaken.recordset.length > 0) {
      return sendConflict(res, 'Board name already exists');
    }

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Update board
      await transaction.request()
        .input('board_id', sql.UniqueIdentifier, id)
        .input('board_name', sql.VarChar(100), name)
        .input('description', sql.Text, description || null)
        .input('is_active', sql.Bit, isActive !== undefined ? isActive : true)
        .query(`
          UPDATE BOARD_MASTER
          SET
            board_name = @board_name,
            description = @description,
            is_active = @is_active,
            updated_at = GETUTCDATE()
          WHERE board_id = @board_id
        `);

      // Update department assignments if provided
      if (departmentIds !== undefined && Array.isArray(departmentIds)) {
        // Delete existing assignments
        await transaction.request()
          .input('board_id', sql.UniqueIdentifier, id)
          .query('DELETE FROM BOARD_DEPARTMENTS WHERE board_id = @board_id');

        // Insert new assignments
        for (const deptId of departmentIds) {
          await transaction.request()
            .input('board_department_id', sql.UniqueIdentifier, uuidv4())
            .input('board_id', sql.UniqueIdentifier, id)
            .input('department_id', sql.UniqueIdentifier, deptId)
            .query(`
              INSERT INTO BOARD_DEPARTMENTS (board_department_id, board_id, department_id)
              VALUES (@board_department_id, @board_id, @department_id)
            `);
        }
      }

      await transaction.commit();

      sendSuccess(res, {
        board: {
          id,
          name,
          description,
          isActive,
          departmentCount: departmentIds ? departmentIds.length : undefined
        }
      }, 'Board updated successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// DELETE /boards/:id - Delete board
router.delete('/:id',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Validate UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return sendError(res, 'Invalid board ID format', 400);
    }

    const pool = await connectDB();

    // Check if board exists
    const existingBoard = await pool.request()
      .input('board_id', sql.UniqueIdentifier, id)
      .query('SELECT board_id FROM BOARD_MASTER WHERE board_id = @board_id');

    if (existingBoard.recordset.length === 0) {
      return sendNotFound(res, 'Board not found');
    }

    // Delete board (CASCADE will delete BOARD_DEPARTMENTS entries)
    await pool.request()
      .input('board_id', sql.UniqueIdentifier, id)
      .query('DELETE FROM BOARD_MASTER WHERE board_id = @board_id');

    sendSuccess(res, null, 'Board deleted successfully');
  })
);

module.exports = router;
