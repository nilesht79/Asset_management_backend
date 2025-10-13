const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const validators = require('../../utils/validators');

const router = express.Router();

// GET /masters/product-types - List all product types with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause for product_types table
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (name LIKE @search OR description LIKE @search)';
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
      FROM product_types 
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limit);

    // Get paginated data
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT id, name, description, is_active, created_at, updated_at
      FROM product_types 
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total, totalPages);

    sendSuccess(res, {
      productTypes: result.recordset,
      pagination
    }, 'Product types retrieved successfully');
  })
);

// GET /masters/product-types/:id - Get product type by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, name, description, is_active, created_at, updated_at
        FROM product_types 
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Product type not found');
    }

    sendSuccess(res, result.recordset[0], 'Product type retrieved successfully');
  })
);

// POST /masters/product-types - Create new product type
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.productType.create),
  asyncHandler(async (req, res) => {
    const { name, description, is_active = true } = req.body;

    const pool = await connectDB();
    
    // Check if product type with same name already exists
    const existingResult = await pool.request()
      .input('name', sql.VarChar(100), name.trim())
      .query(`
        SELECT id FROM product_types 
        WHERE LOWER(name) = LOWER(@name)
      `);

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Product type with this name already exists');
    }

    const id = uuidv4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('name', sql.VarChar(100), name.trim())
      .input('description', sql.VarChar(500), description?.trim() || null)
      .input('is_active', sql.Bit, is_active)
      .query(`
        INSERT INTO product_types (id, name, description, is_active)
        VALUES (@id, @name, @description, @is_active)
      `);

    const newResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, name, description, is_active, created_at, updated_at
        FROM product_types WHERE id = @id
      `);

    sendCreated(res, newResult.recordset[0], 'Product type created successfully');
  })
);

// PUT /masters/product-types/:id - Update product type
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.productType.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    const pool = await connectDB();
    
    // Check if product type exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id FROM product_types 
        WHERE id = @id
      `);

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Product type not found');
    }

    // Check for name conflicts with other product types
    if (name) {
      const conflictResult = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('name', sql.VarChar(100), name?.trim() || '')
        .query(`
          SELECT id FROM product_types 
          WHERE id != @id 
          AND LOWER(name) = LOWER(@name)
        `);

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Product type with this name already exists');
      }
    }

    // Build update query dynamically
    let updateFields = [];
    let updateParams = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];

    if (name !== undefined) {
      updateFields.push('name = @name');
      updateParams.push({ name: 'name', type: sql.VarChar(100), value: name.trim() });
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateParams.push({ name: 'description', type: sql.VarChar(500), value: description?.trim() || null });
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = @is_active');
      updateParams.push({ name: 'is_active', type: sql.Bit, value: is_active });
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const updateRequest = pool.request();
    updateParams.forEach(param => updateRequest.input(param.name, param.type, param.value));

    await updateRequest.query(`
      UPDATE product_types 
      SET ${updateFields.join(', ')}
      WHERE id = @id
    `);

    // Get updated record
    const updatedResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, name, description, is_active, created_at, updated_at
        FROM product_types WHERE id = @id
      `);

    sendSuccess(res, updatedResult.recordset[0], 'Product type updated successfully');
  })
);

// DELETE /masters/product-types/:id - Delete product type
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if product type exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, name FROM product_types 
        WHERE id = @id
      `);

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Product type not found');
    }

    // Check if product type is being used by categories
    const usageResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT 
          (SELECT COUNT(*) FROM categories WHERE product_type_id = @id) as category_count
      `);

    const usage = usageResult.recordset[0];
    if (usage.category_count > 0) {
      return sendConflict(res, 'Cannot delete product type as it is being used by categories');
    }

    // Delete the product type
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM product_types WHERE id = @id');

    sendSuccess(res, { id }, 'Product type deleted successfully');
  })
);

module.exports = router;