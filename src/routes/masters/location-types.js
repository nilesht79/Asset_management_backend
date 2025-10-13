const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const validators = require('../../utils/validators');

const router = express.Router();

// GET /masters/location-types - List all location types with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (location_type LIKE @search OR description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (status) {
      whereClause += ' AND is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM location_types
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['location_type', 'description', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT id, location_type, description, is_active, created_at, updated_at
      FROM location_types
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      location_types: result.recordset,
      pagination
    }, 'Location types retrieved successfully');
  })
);

// GET /masters/location-types/dropdown - Get location types for dropdown
router.get('/dropdown',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    
    const result = await pool.request().query(`
      SELECT id, location_type as label, id as value
      FROM location_types
      WHERE is_active = 1
      ORDER BY location_type
    `);

    sendSuccess(res, result.recordset, 'Location types dropdown retrieved successfully');
  })
);

// GET /masters/location-types/:id - Get location type by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, location_type, description, is_active, created_at, updated_at
        FROM location_types
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Location type not found');
    }

    sendSuccess(res, result.recordset[0], 'Location type retrieved successfully');
  })
);

// POST /masters/location-types - Create new location type
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.locationType.create),
  asyncHandler(async (req, res) => {
    const { location_type, description, is_active = true } = req.body;

    const pool = await connectDB();
    
    // Check if location type with same name already exists
    const existingResult = await pool.request()
      .input('locationType', sql.VarChar(100), location_type.trim())
      .query('SELECT id FROM location_types WHERE LOWER(location_type) = LOWER(@locationType)');

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Location type with this name already exists');
    }

    const locationTypeId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, locationTypeId)
      .input('locationType', sql.VarChar(100), location_type.trim())
      .input('description', sql.VarChar(500), description?.trim() || null)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO location_types (id, location_type, description, is_active, created_at, updated_at)
        VALUES (@id, @locationType, @description, @isActive, GETUTCDATE(), GETUTCDATE());
        
        SELECT id, location_type, description, is_active, created_at, updated_at
        FROM location_types
        WHERE id = @id;
      `);

    sendCreated(res, result.recordset[0], 'Location type created successfully');
  })
);

// PUT /masters/location-types/:id - Update location type
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.locationType.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { location_type, description, is_active } = req.body;

    const pool = await connectDB();
    
    // Check if location type exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT location_type FROM location_types WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Location type not found');
    }

    // Check for name conflicts if name is being updated
    if (location_type) {
      const conflictResult = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('locationType', sql.VarChar(100), location_type.trim())
        .query('SELECT id FROM location_types WHERE LOWER(location_type) = LOWER(@locationType) AND id != @id');

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Location type with this name already exists');
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (location_type !== undefined) {
      updateFields.push('location_type = @locationType');
      updateRequest.input('locationType', sql.VarChar(100), location_type.trim());
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateRequest.input('description', sql.VarChar(500), description?.trim() || null);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = @isActive');
      updateRequest.input('isActive', sql.Bit, is_active);
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const result = await updateRequest.query(`
      UPDATE location_types 
      SET ${updateFields.join(', ')}
      WHERE id = @id;
      
      SELECT id, location_type, description, is_active, created_at, updated_at
      FROM location_types
      WHERE id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'Location type updated successfully');
  })
);

// DELETE /masters/location-types/:id - Delete location type
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if location type exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM location_types WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Location type not found');
    }

    // Check if location type is being used by locations
    const usageResult = await pool.request()
      .input('locationTypeId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM locations WHERE location_type_id = @locationTypeId AND is_active = 1');

    if (usageResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete location type. It is being used by active locations.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE location_types 
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Location type deleted successfully');
  })
);

module.exports = router;