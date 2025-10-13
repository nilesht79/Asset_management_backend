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

// GET /masters/subcategories - List all subcategories with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, category_id } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause - only show subcategories
    let whereClause = 'sc.parent_category_id IS NOT NULL';
    const params = [];
    
    if (search) {
      whereClause += ' AND (sc.name LIKE @search OR sc.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (status) {
      whereClause += ' AND sc.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (category_id) {
      whereClause += ' AND sc.parent_category_id = @categoryId';
      params.push({ name: 'categoryId', type: sql.UniqueIdentifier, value: category_id });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM categories sc
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `sc.${sortBy}` : 'sc.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT sc.id, sc.name, sc.description, sc.parent_category_id, sc.is_active, 
             sc.created_at, sc.updated_at,
             pc.name as parent_category_name,
             (SELECT COUNT(*) FROM products WHERE subcategory_id = sc.id AND is_active = 1) as product_count
      FROM categories sc
      LEFT JOIN categories pc ON sc.parent_category_id = pc.id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    // Transform data to match frontend expectations
    const subcategories = result.recordset.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      parent_category_id: row.parent_category_id,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      product_count: row.product_count,
      parent_category: row.parent_category_name ? {
        id: row.parent_category_id,
        name: row.parent_category_name
      } : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      subcategories,
      pagination
    }, 'Product subcategories retrieved successfully');
  })
);

// GET /masters/subcategories/:id - Get subcategory by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT sc.id, sc.name, sc.description, sc.parent_category_id, sc.is_active, 
               sc.created_at, sc.updated_at,
               pc.name as parent_category_name,
               (SELECT COUNT(*) FROM products WHERE subcategory_id = sc.id AND is_active = 1) as product_count
        FROM categories sc
        LEFT JOIN categories pc ON sc.parent_category_id = pc.id
        WHERE sc.id = @id AND sc.parent_category_id IS NOT NULL
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Subcategory not found');
    }

    const row = result.recordset[0];
    const subcategory = {
      id: row.id,
      name: row.name,
      description: row.description,
      parent_category_id: row.parent_category_id,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      product_count: row.product_count,
      parent_category: row.parent_category_name ? {
        id: row.parent_category_id,
        name: row.parent_category_name
      } : null
    };

    sendSuccess(res, subcategory, 'Product subcategory retrieved successfully');
  })
);

// POST /masters/subcategories - Create new subcategory
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.category.create),
  asyncHandler(async (req, res) => {
    const { name, description, parent_category_id, is_active = true } = req.body;

    const pool = await connectDB();
    
    // Verify that the parent category exists
    const categoryResult = await pool.request()
      .input('categoryId', sql.UniqueIdentifier, parent_category_id)
      .query(`
        SELECT id, name FROM categories 
        WHERE id = @categoryId AND is_active = 1 AND parent_category_id IS NULL
      `);

    if (categoryResult.recordset.length === 0) {
      return sendNotFound(res, 'Parent category not found or inactive');
    }

    // Check if subcategory with same name already exists in this category
    const existingResult = await pool.request()
      .input('name', sql.VarChar(100), name.trim())
      .input('categoryId', sql.UniqueIdentifier, parent_category_id)
      .query(`
        SELECT id FROM categories 
        WHERE LOWER(name) = LOWER(@name) AND parent_category_id = @categoryId
      `);

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Product subcategory with this name already exists in this category');
    }

    const subcategoryId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, subcategoryId)
      .input('name', sql.VarChar(100), name.trim())
      .input('description', sql.VarChar(500), description)
      .input('categoryId', sql.UniqueIdentifier, parent_category_id)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO categories (
          id, name, description, parent_category_id, is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @description, @categoryId, @isActive, GETUTCDATE(), GETUTCDATE()
        );
        
        SELECT sc.id, sc.name, sc.description, sc.parent_category_id, sc.is_active, 
               sc.created_at, sc.updated_at,
               pc.name as parent_category_name
        FROM categories sc
        LEFT JOIN categories pc ON sc.parent_category_id = pc.id
        WHERE sc.id = @id;
      `);

    const row = result.recordset[0];
    const subcategory = {
      id: row.id,
      name: row.name,
      description: row.description,
      parent_category_id: row.parent_category_id,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      parent_category: row.parent_category_name ? {
        id: row.parent_category_id,
        name: row.parent_category_name
      } : null
    };

    sendCreated(res, subcategory, 'Product subcategory created successfully');
  })
);

// PUT /masters/subcategories/:id - Update subcategory
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.category.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, parent_category_id, is_active } = req.body;

    const pool = await connectDB();
    
    // Check if subcategory exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name, parent_category_id FROM categories WHERE id = @id AND parent_category_id IS NOT NULL');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Product subcategory not found');
    }

    const existingSubcategory = existingResult.recordset[0];

    // Verify that the parent category exists (if being updated)
    if (parent_category_id && parent_category_id !== existingSubcategory.parent_category_id) {
      const categoryResult = await pool.request()
        .input('categoryId', sql.UniqueIdentifier, parent_category_id)
        .query(`
          SELECT id FROM categories 
          WHERE id = @categoryId AND is_active = 1 AND parent_category_id IS NULL
        `);

      if (categoryResult.recordset.length === 0) {
        return sendNotFound(res, 'Parent category not found or inactive');
      }
    }

    // Check for name conflict if being updated
    if ((name && name.trim() !== existingSubcategory.name) || (parent_category_id && parent_category_id !== existingSubcategory.parent_category_id)) {
      const checkName = name ? name.trim() : existingSubcategory.name;
      const checkCategoryId = parent_category_id || existingSubcategory.parent_category_id;
      
      const conflictResult = await pool.request()
        .input('name', sql.VarChar(100), checkName)
        .input('categoryId', sql.UniqueIdentifier, checkCategoryId)
        .input('id', sql.UniqueIdentifier, id)
        .query(`
          SELECT id FROM categories 
          WHERE LOWER(name) = LOWER(@name) AND parent_category_id = @categoryId AND id != @id
        `);

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Product subcategory with this name already exists in this category');
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updateFields.push('name = @name');
      updateRequest.input('name', sql.VarChar(100), name.trim());
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateRequest.input('description', sql.VarChar(500), description);
    }
    if (parent_category_id !== undefined) {
      updateFields.push('parent_category_id = @categoryId');
      updateRequest.input('categoryId', sql.UniqueIdentifier, parent_category_id);
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
      UPDATE categories 
      SET ${updateFields.join(', ')}
      WHERE id = @id;
      
      SELECT sc.id, sc.name, sc.description, sc.parent_category_id, sc.is_active, 
             sc.created_at, sc.updated_at,
             pc.name as parent_category_name
      FROM categories sc
      LEFT JOIN categories pc ON sc.parent_category_id = pc.id
      WHERE sc.id = @id;
    `);

    const row = result.recordset[0];
    const subcategory = {
      id: row.id,
      name: row.name,
      description: row.description,
      parent_category_id: row.parent_category_id,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      parent_category: row.parent_category_name ? {
        id: row.parent_category_id,
        name: row.parent_category_name
      } : null
    };

    sendSuccess(res, subcategory, 'Product subcategory updated successfully');
  })
);

// DELETE /masters/subcategories/:id - Delete subcategory
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if subcategory exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM categories WHERE id = @id AND parent_category_id IS NOT NULL');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Product subcategory not found');
    }

    // Check if subcategory is referenced by products
    const productRefsResult = await pool.request()
      .input('subcategoryId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM products WHERE subcategory_id = @subcategoryId AND is_active = 1');

    if (productRefsResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete subcategory. It is referenced by existing products.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE categories 
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Product subcategory deleted successfully');
  })
);

module.exports = router;