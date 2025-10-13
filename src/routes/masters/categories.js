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

// GET /masters/categories - List all categories with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause - only show parent categories
    let whereClause = 'c.parent_category_id IS NULL';
    const params = [];
    
    if (search) {
      whereClause += ' AND (c.name LIKE @search OR c.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (status) {
      whereClause += ' AND c.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM categories c
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `c.${sortBy}` : 'c.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT c.id, c.name, c.description, c.parent_category_id, c.is_active, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM categories WHERE parent_category_id = c.id) as subcategory_count,
             (SELECT COUNT(*) FROM products WHERE category_id = c.id AND is_active = 1) as product_count
      FROM categories c
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      categories: result.recordset,
      pagination
    }, 'Categories retrieved successfully');
  })
);

// GET /masters/categories/:id - Get category by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT c.id, c.name, c.description, c.parent_category_id, c.is_active, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM categories WHERE parent_category_id = c.id) as subcategory_count,
               (SELECT COUNT(*) FROM products WHERE category_id = c.id AND is_active = 1) as product_count
        FROM categories c
        WHERE c.id = @id AND c.parent_category_id IS NULL
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Category not found');
    }

    sendSuccess(res, result.recordset[0], 'Category retrieved successfully');
  })
);

// POST /masters/categories - Create new category
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.category.create),
  asyncHandler(async (req, res) => {
    const { name, description, parent_category_id, is_active = true } = req.body;

    const pool = await connectDB();
    
    // Check if category with same name already exists
    const existingResult = await pool.request()
      .input('name', sql.VarChar(100), name.trim())
      .query(`
        SELECT id FROM categories 
        WHERE LOWER(name) = LOWER(@name)
      `);

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Category with this name already exists');
    }

    const categoryId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, categoryId)
      .input('name', sql.VarChar(100), name.trim())
      .input('description', sql.VarChar(500), description)
      .input('parentCategoryId', sql.UniqueIdentifier, parent_category_id || null)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO categories (
          id, name, description, parent_category_id, is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @description, @parentCategoryId, @isActive, GETUTCDATE(), GETUTCDATE()
        );
        
        SELECT id, name, description, parent_category_id, is_active, created_at, updated_at
        FROM categories
        WHERE id = @id;
      `);

    const category = result.recordset[0];
    sendCreated(res, category, 'Category created successfully');
  })
);

// PUT /masters/categories/:id - Update category
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.category.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, parent_category_id, is_active } = req.body;

    const pool = await connectDB();
    
    // Check if category exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name FROM categories WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Category not found');
    }

    const existingCategory = existingResult.recordset[0];

    // Check for name conflict if being updated
    if (name && name.trim() !== existingCategory.name) {
      const conflictResult = await pool.request()
        .input('name', sql.VarChar(100), name.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query(`
          SELECT id FROM categories 
          WHERE LOWER(name) = LOWER(@name) AND id != @id
        `);

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Category with this name already exists');
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
      updateFields.push('parent_category_id = @parentCategoryId');
      updateRequest.input('parentCategoryId', sql.UniqueIdentifier, parent_category_id);
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
      
      SELECT id, name, description, parent_category_id, is_active, created_at, updated_at
      FROM categories
      WHERE id = @id;
    `);

    const category = result.recordset[0];
    sendSuccess(res, category, 'Category updated successfully');
  })
);

// DELETE /masters/categories/:id - Delete category
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if category exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM categories WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Category not found');
    }

    // Check if category is referenced by subcategories
    const subcategoryRefsResult = await pool.request()
      .input('categoryId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM categories WHERE parent_category_id = @categoryId');

    if (subcategoryRefsResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete category. It is referenced by existing subcategories.');
    }

    // Check if category is referenced by products
    const productRefsResult = await pool.request()
      .input('categoryId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM products WHERE category_id = @categoryId AND is_active = 1');

    if (productRefsResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete category. It is referenced by existing products.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE categories 
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Category deleted successfully');
  })
);

// GET /masters/categories/:id/subcategories - Get subcategories for a category
router.get('/:id/subcategories',
  requireDynamicPermission(),
  validateUUID('id'),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status } = req.query;

    const pool = await connectDB();
    
    // First verify the parent category exists
    const parentResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name FROM categories WHERE id = @id AND parent_category_id IS NULL');

    if (parentResult.recordset.length === 0) {
      return sendNotFound(res, 'Parent category not found');
    }

    // Build WHERE clause for subcategories
    let whereClause = 'sc.parent_category_id = @parentId';
    const params = [
      { name: 'parentId', type: sql.UniqueIdentifier, value: id }
    ];
    
    if (search) {
      whereClause += ' AND (sc.name LIKE @search OR sc.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (status) {
      whereClause += ' AND sc.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
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
             (SELECT COUNT(*) FROM products WHERE subcategory_id = sc.id AND is_active = 1) as product_count
      FROM categories sc
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      parentCategory: parentResult.recordset[0],
      subcategories: result.recordset,
      pagination
    }, 'Subcategories retrieved successfully');
  })
);

// POST /masters/categories/:id/subcategories - Create subcategory under a category
router.post('/:id/subcategories',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.category.create),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, is_active = true } = req.body;

    const pool = await connectDB();
    
    // Verify parent category exists and is active
    const parentResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name FROM categories WHERE id = @id AND parent_category_id IS NULL AND is_active = 1');

    if (parentResult.recordset.length === 0) {
      return sendNotFound(res, 'Parent category not found or inactive');
    }

    // Check if subcategory with same name already exists under this parent
    const existingResult = await pool.request()
      .input('name', sql.VarChar(100), name.trim())
      .input('parentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT id FROM categories 
        WHERE LOWER(name) = LOWER(@name) AND parent_category_id = @parentId
      `);

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Subcategory with this name already exists under this category');
    }

    const subcategoryId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, subcategoryId)
      .input('name', sql.VarChar(100), name.trim())
      .input('description', sql.VarChar(500), description)
      .input('parentCategoryId', sql.UniqueIdentifier, id)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO categories (
          id, name, description, parent_category_id, is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @description, @parentCategoryId, @isActive, GETUTCDATE(), GETUTCDATE()
        );
        
        SELECT id, name, description, parent_category_id, is_active, created_at, updated_at
        FROM categories
        WHERE id = @id;
      `);

    const subcategory = result.recordset[0];
    sendCreated(res, subcategory, 'Subcategory created successfully');
  })
);

module.exports = router;