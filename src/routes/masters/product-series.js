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

// GET /masters/product-series - List all product series with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, category_id, sub_category_id, oem_id } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (ps.name LIKE @search OR ps.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (status) {
      whereClause += ' AND ps.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (category_id) {
      whereClause += ' AND ps.category_id = @categoryId';
      params.push({ name: 'categoryId', type: sql.UniqueIdentifier, value: category_id });
    }

    if (sub_category_id) {
      whereClause += ' AND ps.sub_category_id = @subCategoryId';
      params.push({ name: 'subCategoryId', type: sql.UniqueIdentifier, value: sub_category_id });
    }

    if (oem_id) {
      whereClause += ' AND ps.oem_id = @oemId';
      params.push({ name: 'oemId', type: sql.UniqueIdentifier, value: oem_id });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM product_series ps
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get paginated data with related information
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `ps.${sortBy}` : 'ps.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';
    
    const dataResult = await dataRequest.query(`
      SELECT 
        ps.id,
        ps.name,
        ps.description,
        ps.is_active,
        ps.created_at,
        ps.updated_at,
        -- OEM information
        o.id as oem_id,
        o.name as oem_name,
        -- Category information
        c.id as category_id,
        c.name as category_name,
        -- Sub Category information
        sc.id as sub_category_id,
        sc.name as sub_category_name
      FROM product_series ps
      LEFT JOIN oems o ON ps.oem_id = o.id
      LEFT JOIN categories c ON ps.category_id = c.id
      LEFT JOIN categories sc ON ps.sub_category_id = sc.id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const productSeries = dataResult.recordset.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      oem: row.oem_id ? {
        id: row.oem_id,
        name: row.oem_name
      } : null,
      category: row.category_id ? {
        id: row.category_id,
        name: row.category_name
      } : null,
      subCategory: row.sub_category_id ? {
        id: row.sub_category_id,
        name: row.sub_category_name
      } : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      productSeries,
      pagination
    }, 'Product series retrieved successfully');
  })
);

// GET /masters/product-series/:id - Get single product series by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const request = pool.request();
    request.input('id', sql.UniqueIdentifier, id);

    const result = await request.query(`
      SELECT 
        ps.id,
        ps.name,
        ps.description,
        ps.is_active,
        ps.created_at,
        ps.updated_at,
        -- OEM information
        o.id as oem_id,
        o.name as oem_name,
        -- Category information
        c.id as category_id,
        c.name as category_name,
        -- Sub Category information
        sc.id as sub_category_id,
        sc.name as sub_category_name
      FROM product_series ps
      LEFT JOIN oems o ON ps.oem_id = o.id
      LEFT JOIN categories c ON ps.category_id = c.id
      LEFT JOIN categories sc ON ps.sub_category_id = sc.id
      WHERE ps.id = @id
    `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Product series not found');
    }

    const row = result.recordset[0];
    const productSeries = {
      id: row.id,
      name: row.name,
      description: row.description,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      oem: row.oem_id ? {
        id: row.oem_id,
        name: row.oem_name
      } : null,
      category: row.category_id ? {
        id: row.category_id,
        name: row.category_name
      } : null,
      subCategory: row.sub_category_id ? {
        id: row.sub_category_id,
        name: row.sub_category_name
      } : null
    };

    sendSuccess(res, productSeries, 'Product series retrieved successfully');
  })
);

// POST /masters/product-series - Create new product series
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.productSeries.create),
  asyncHandler(async (req, res) => {
    const { name, description, oem_id, category_id, sub_category_id } = req.body;
    const pool = await connectDB();

    // Check if product series with same name already exists
    const checkRequest = pool.request();
    checkRequest.input('name', sql.VarChar(255), name);
    
    const checkResult = await checkRequest.query(`
      SELECT COUNT(*) as count 
      FROM product_series 
      WHERE name = @name
    `);

    if (checkResult.recordset[0].count > 0) {
      return sendConflict(res, 'Product series with this name already exists');
    }

    // Verify that OEM, category, and sub-category exist
    const verifyRequest = pool.request();
    verifyRequest.input('oemId', sql.UniqueIdentifier, oem_id);
    verifyRequest.input('categoryId', sql.UniqueIdentifier, category_id);
    verifyRequest.input('subCategoryId', sql.UniqueIdentifier, sub_category_id);

    const verifyResult = await verifyRequest.query(`
      SELECT 
        (SELECT COUNT(*) FROM oems WHERE id = @oemId) as oem_exists,
        (SELECT COUNT(*) FROM categories WHERE id = @categoryId) as category_exists,
        (SELECT COUNT(*) FROM categories WHERE id = @subCategoryId) as sub_category_exists
    `);

    const { oem_exists, category_exists, sub_category_exists } = verifyResult.recordset[0];
    
    if (!oem_exists) {
      return sendError(res, 'OEM not found', 400);
    }
    if (!category_exists) {
      return sendError(res, 'Category not found', 400);
    }
    if (!sub_category_exists) {
      return sendError(res, 'Sub category not found', 400);
    }

    // Create product series
    const seriesId = uuidv4();
    const createRequest = pool.request();
    createRequest.input('id', sql.UniqueIdentifier, seriesId);
    createRequest.input('name', sql.VarChar(255), name);
    createRequest.input('description', sql.Text, description || null);
    createRequest.input('oemId', sql.UniqueIdentifier, oem_id);
    createRequest.input('categoryId', sql.UniqueIdentifier, category_id);
    createRequest.input('subCategoryId', sql.UniqueIdentifier, sub_category_id);

    const result = await createRequest.query(`
      INSERT INTO product_series (
        id, name, description, oem_id, category_id, sub_category_id, 
        is_active, created_at, updated_at
      ) VALUES (
        @id, @name, @description, @oemId, @categoryId, @subCategoryId,
        1, GETUTCDATE(), GETUTCDATE()
      );
      
      SELECT id, name, description, oem_id, category_id, sub_category_id, 
             is_active, created_at, updated_at
      FROM product_series WHERE id = @id;
    `);

    sendCreated(res, result.recordset[0], 'Product series created successfully');
  })
);

// PUT /masters/product-series/:id - Update product series
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.productSeries.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, oem_id, category_id, sub_category_id } = req.body;
    const pool = await connectDB();

    // Check if product series exists
    const checkRequest = pool.request();
    checkRequest.input('id', sql.UniqueIdentifier, id);
    
    const checkResult = await checkRequest.query(`
      SELECT COUNT(*) as count 
      FROM product_series 
      WHERE id = @id
    `);

    if (checkResult.recordset[0].count === 0) {
      return sendNotFound(res, 'Product series not found');
    }

    // Check for duplicate name (excluding current record)
    if (name) {
      const duplicateRequest = pool.request();
      duplicateRequest.input('id', sql.UniqueIdentifier, id);
      duplicateRequest.input('name', sql.VarChar(255), name);
      
      const duplicateResult = await duplicateRequest.query(`
        SELECT COUNT(*) as count 
        FROM product_series 
        WHERE name = @name AND id != @id
      `);

      if (duplicateResult.recordset[0].count > 0) {
        return sendConflict(res, 'Product series with this name already exists');
      }
    }

    // Verify referenced entities exist (if being updated)
    if (oem_id || category_id || sub_category_id) {
      const verifyRequest = pool.request();
      if (oem_id) verifyRequest.input('oemId', sql.UniqueIdentifier, oem_id);
      if (category_id) verifyRequest.input('categoryId', sql.UniqueIdentifier, category_id);
      if (sub_category_id) verifyRequest.input('subCategoryId', sql.UniqueIdentifier, sub_category_id);

      let verifyQuery = 'SELECT ';
      const verifyParts = [];
      
      if (oem_id) verifyParts.push('(SELECT COUNT(*) FROM oems WHERE id = @oemId) as oem_exists');
      if (category_id) verifyParts.push('(SELECT COUNT(*) FROM categories WHERE id = @categoryId) as category_exists');
      if (sub_category_id) verifyParts.push('(SELECT COUNT(*) FROM categories WHERE id = @subCategoryId) as sub_category_exists');
      
      verifyQuery += verifyParts.join(', ');

      const verifyResult = await verifyRequest.query(verifyQuery);
      const verification = verifyResult.recordset[0];
      
      if (oem_id && !verification.oem_exists) {
        return sendError(res, 'OEM not found', 400);
      }
      if (category_id && !verification.category_exists) {
        return sendError(res, 'Category not found', 400);
      }
      if (sub_category_id && !verification.sub_category_exists) {
        return sendError(res, 'Sub category not found', 400);
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updateFields.push('name = @name');
      updateRequest.input('name', sql.VarChar(255), name);
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateRequest.input('description', sql.Text, description);
    }
    if (oem_id !== undefined) {
      updateFields.push('oem_id = @oemId');
      updateRequest.input('oemId', sql.UniqueIdentifier, oem_id);
    }
    if (category_id !== undefined) {
      updateFields.push('category_id = @categoryId');
      updateRequest.input('categoryId', sql.UniqueIdentifier, category_id);
    }
    if (sub_category_id !== undefined) {
      updateFields.push('sub_category_id = @subCategoryId');
      updateRequest.input('subCategoryId', sql.UniqueIdentifier, sub_category_id);
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const result = await updateRequest.query(`
      UPDATE product_series 
      SET ${updateFields.join(', ')}
      WHERE id = @id;
      
      SELECT id, name, description, oem_id, category_id, sub_category_id, 
             is_active, created_at, updated_at
      FROM product_series WHERE id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'Product series updated successfully');
  })
);

// DELETE /masters/product-series/:id - Delete product series
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    // Check if product series exists
    const checkRequest = pool.request();
    checkRequest.input('id', sql.UniqueIdentifier, id);
    
    const checkResult = await checkRequest.query(`
      SELECT COUNT(*) as count 
      FROM product_series 
      WHERE id = @id
    `);

    if (checkResult.recordset[0].count === 0) {
      return sendNotFound(res, 'Product series not found');
    }

    // Check if product series is being used by any products
    const usageRequest = pool.request();
    usageRequest.input('id', sql.UniqueIdentifier, id);
    
    const usageResult = await usageRequest.query(`
      SELECT COUNT(*) as count 
      FROM products 
      WHERE series_id = @id AND is_active = 1
    `);

    if (usageResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete product series. It is referenced by existing products.');
    }

    // Soft delete - mark as inactive
    const deleteRequest = pool.request();
    deleteRequest.input('id', sql.UniqueIdentifier, id);

    await deleteRequest.query(`
      UPDATE product_series 
      SET is_active = 0, updated_at = GETUTCDATE()
      WHERE id = @id
    `);

    sendSuccess(res, null, 'Product series deleted successfully');
  })
);

module.exports = router;