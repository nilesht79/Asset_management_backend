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

// GET /masters/vendors - List all vendors with pagination and search
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
      whereClause += ' AND (name LIKE @search OR code LIKE @search)';
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
      SELECT COUNT(*) as total FROM vendors WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'code', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT id, name, code, is_active, created_at, updated_at
      FROM vendors
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      vendors: result.recordset,
      pagination
    }, 'Vendors retrieved successfully');
  })
);

// GET /masters/vendors/:id - Get vendor by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, name, code, is_active, created_at, updated_at
        FROM vendors
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Vendor not found');
    }

    sendSuccess(res, result.recordset[0], 'Vendor retrieved successfully');
  })
);

// POST /masters/vendors - Create new vendor
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.vendor.create),
  asyncHandler(async (req, res) => {
    const { name, code, is_active = true } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return sendError(res, 'Vendor name is required', 400);
    }

    const pool = await connectDB();

    // Check if vendor with same name already exists
    const existingResult = await pool.request()
      .input('name', sql.VarChar(255), name.trim())
      .query('SELECT id FROM vendors WHERE LOWER(name) = LOWER(@name)');

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Vendor with this name already exists');
    }

    // Check if code is provided and already exists
    if (code) {
      const codeResult = await pool.request()
        .input('code', sql.VarChar(50), code.trim())
        .query('SELECT id FROM vendors WHERE LOWER(code) = LOWER(@code)');

      if (codeResult.recordset.length > 0) {
        return sendConflict(res, 'Vendor with this code already exists');
      }
    }

    const vendorId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, vendorId)
      .input('name', sql.VarChar(255), name.trim())
      .input('code', sql.VarChar(50), code ? code.trim() : null)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO vendors (id, name, code, is_active, created_at, updated_at)
        VALUES (@id, @name, @code, @isActive, GETUTCDATE(), GETUTCDATE());

        SELECT id, name, code, is_active, created_at, updated_at
        FROM vendors WHERE id = @id;
      `);

    sendCreated(res, result.recordset[0], 'Vendor created successfully');
  })
);

// PUT /masters/vendors/:id - Update vendor
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.vendor.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, code, is_active } = req.body;

    const pool = await connectDB();

    // Check if vendor exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name FROM vendors WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Vendor not found');
    }

    // Check if name is being updated and if it conflicts with existing vendor
    if (name && name.trim() !== existingResult.recordset[0].name) {
      const nameConflictResult = await pool.request()
        .input('name', sql.VarChar(255), name.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT id FROM vendors WHERE LOWER(name) = LOWER(@name) AND id != @id');

      if (nameConflictResult.recordset.length > 0) {
        return sendConflict(res, 'Vendor with this name already exists');
      }
    }

    // Check if code is being updated and if it conflicts
    if (code) {
      const codeConflictResult = await pool.request()
        .input('code', sql.VarChar(50), code.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT id FROM vendors WHERE LOWER(code) = LOWER(@code) AND id != @id');

      if (codeConflictResult.recordset.length > 0) {
        return sendConflict(res, 'Vendor with this code already exists');
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updateFields.push('name = @name');
      updateRequest.input('name', sql.VarChar(255), name.trim());
    }
    if (code !== undefined) {
      updateFields.push('code = @code');
      updateRequest.input('code', sql.VarChar(50), code ? code.trim() : null);
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
      UPDATE vendors
      SET ${updateFields.join(', ')}
      WHERE id = @id;

      SELECT id, name, code, is_active, created_at, updated_at
      FROM vendors WHERE id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'Vendor updated successfully');
  })
);

// DELETE /masters/vendors/:id - Delete vendor (soft delete)
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if vendor exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM vendors WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Vendor not found');
    }

    // Check if vendor is referenced by any assets
    const referencesResult = await pool.request()
      .input('vendorId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM assets WHERE vendor_id = @vendorId');

    if (referencesResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete vendor. It is referenced by existing assets.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE vendors
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Vendor deleted successfully');
  })
);

// GET /masters/vendors/:id/assets - Get assets for a vendor
router.get('/:id/assets',
  requireDynamicPermission(),
  validateUUID('id'),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit, offset } = req.pagination;

    const pool = await connectDB();

    // Check if vendor exists
    const vendorResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT name FROM vendors WHERE id = @id');

    if (vendorResult.recordset.length === 0) {
      return sendNotFound(res, 'Vendor not found');
    }

    // Get total count of assets for this vendor
    const countResult = await pool.request()
      .input('vendorId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as total FROM assets WHERE vendor_id = @vendorId AND is_active = 1');

    const total = countResult.recordset[0].total;

    // Get paginated assets
    const result = await pool.request()
      .input('vendorId', sql.UniqueIdentifier, id)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT a.id, a.asset_tag, a.serial_number, a.status, a.condition_status,
               a.purchase_date, a.invoice_number, a.purchase_cost,
               p.name as product_name,
               a.created_at, a.updated_at
        FROM assets a
        LEFT JOIN products p ON a.product_id = p.id
        WHERE a.vendor_id = @vendorId AND a.is_active = 1
        ORDER BY a.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      vendor: vendorResult.recordset[0],
      assets: result.recordset,
      pagination
    }, 'Vendor assets retrieved successfully');
  })
);

module.exports = router;
