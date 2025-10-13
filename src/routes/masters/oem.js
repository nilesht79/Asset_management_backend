const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const validators = require('../../utils/validators');
const ExcelJS = require('exceljs');

const router = express.Router();

// GET /masters/oem/export - Export OEMs to Excel
// IMPORTANT: This route must be defined BEFORE /:id to prevent "export" being treated as an ID
router.get('/export',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { format = 'xlsx', search, status } = req.query;

    const pool = await connectDB();

    // Build WHERE clause for export (same as list query)
    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (name LIKE @search OR description LIKE @search OR contact_person LIKE @search OR email LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    // Get all OEMs for export (no pagination)
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT id, name, code, description, contact_person, email, phone, website,
             address, is_active, created_at, updated_at
      FROM oems
      WHERE ${whereClause}
      ORDER BY created_at DESC
    `);

    if (format === 'xlsx') {
      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('OEMs');

      // Add headers
      worksheet.columns = [
        { header: 'OEM ID', key: 'id', width: 15 },
        { header: 'OEM Name', key: 'name', width: 30 },
        { header: 'Code', key: 'code', width: 15 },
        { header: 'Contact Person', key: 'contact_person', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Phone', key: 'phone', width: 20 },
        { header: 'Website', key: 'website', width: 30 },
        { header: 'Address', key: 'address', width: 40 },
        { header: 'Status', key: 'is_active', width: 15 },
        { header: 'Created Date', key: 'created_at', width: 20 },
        { header: 'Updated Date', key: 'updated_at', width: 20 }
      ];

      // Style headers
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      result.recordset.forEach((oem, index) => {
        worksheet.addRow({
          id: String(index + 1).padStart(2, '0'),
          name: oem.name,
          code: oem.code,
          contact_person: oem.contact_person,
          email: oem.email,
          phone: oem.phone,
          website: oem.website,
          address: oem.address,
          is_active: oem.is_active ? 'Active' : 'Inactive',
          created_at: oem.created_at ? new Date(oem.created_at).toLocaleDateString() : '',
          updated_at: oem.updated_at ? new Date(oem.updated_at).toLocaleDateString() : ''
        });
      });

      // Set response headers for download
      const fileName = `oems_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      // Write to response
      await workbook.xlsx.write(res);
      res.end();
    } else {
      // Return JSON format
      sendSuccess(res, {
        oems: result.recordset,
        total: result.recordset.length,
        exportedAt: new Date().toISOString()
      }, 'OEMs exported successfully');
    }
  })
);

// GET /masters/oem - List all OEMs with pagination and search
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
      whereClause += ' AND (name LIKE @search OR description LIKE @search OR contact_person LIKE @search OR email LIKE @search)';
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
      SELECT COUNT(*) as total FROM oems WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'contact_person', 'email', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT id, name, code, description, contact_person, email, phone, website, 
             address, is_active, created_at, updated_at
      FROM oems 
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      oems: result.recordset,
      pagination
    }, 'OEMs retrieved successfully');
  })
);

// GET /masters/oem/:id - Get OEM by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, name, code, description, contact_person, email, phone, website, 
               address, is_active, created_at, updated_at
        FROM oems 
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'OEM not found');
    }

    sendSuccess(res, result.recordset[0], 'OEM retrieved successfully');
  })
);

// POST /masters/oem - Create new OEM
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.oem.create),
  asyncHandler(async (req, res) => {
    const { name, code, description, contact_person, email, phone, website, address, is_active = true } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return sendError(res, 'OEM name is required', 400);
    }
    if (!code || !code.trim()) {
      return sendError(res, 'OEM code is required', 400);
    }

    const pool = await connectDB();
    
    // Check if OEM with same name already exists
    const existingResult = await pool.request()
      .input('name', sql.VarChar(100), name.trim())
      .query('SELECT id FROM oems WHERE LOWER(name) = LOWER(@name)');

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'OEM with this name already exists');
    }

    // Check if email is provided and already exists
    if (email) {
      const emailResult = await pool.request()
        .input('email', sql.VarChar(255), email.toLowerCase())
        .query('SELECT id FROM oems WHERE LOWER(email) = LOWER(@email)');

      if (emailResult.recordset.length > 0) {
        return sendConflict(res, 'OEM with this email already exists');
      }
    }

    const oemId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, oemId)
      .input('name', sql.VarChar(100), name.trim())
      .input('code', sql.VarChar(20), code.trim())
      .input('description', sql.VarChar(500), description)
      .input('contactPerson', sql.VarChar(100), contact_person)
      .input('email', sql.VarChar(255), email ? email.toLowerCase() : null)
      .input('phone', sql.VarChar(20), phone)
      .input('website', sql.VarChar(255), website)
      .input('address', sql.VarChar(500), address)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO oems (id, name, code, description, contact_person, email, phone, website, address, is_active, created_at, updated_at)
        VALUES (@id, @name, @code, @description, @contactPerson, @email, @phone, @website, @address, @isActive, GETUTCDATE(), GETUTCDATE());
        
        SELECT id, name, code, description, contact_person, email, phone, website, address, is_active, created_at, updated_at
        FROM oems WHERE id = @id;
      `);

    sendCreated(res, result.recordset[0], 'OEM created successfully');
  })
);

// PUT /masters/oem/:id - Update OEM
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.oem.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, code, description, contact_person, email, phone, website, address, is_active } = req.body;

    const pool = await connectDB();
    
    // Check if OEM exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name FROM oems WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'OEM not found');
    }

    // Check if name is being updated and if it conflicts with existing OEM
    if (name && name.trim() !== existingResult.recordset[0].name) {
      const nameConflictResult = await pool.request()
        .input('name', sql.VarChar(100), name.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT id FROM oems WHERE LOWER(name) = LOWER(@name) AND id != @id');

      if (nameConflictResult.recordset.length > 0) {
        return sendConflict(res, 'OEM with this name already exists');
      }
    }

    // Check if email is being updated and if it conflicts
    if (email) {
      const emailConflictResult = await pool.request()
        .input('email', sql.VarChar(255), email.toLowerCase())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT id FROM oems WHERE LOWER(email) = LOWER(@email) AND id != @id');

      if (emailConflictResult.recordset.length > 0) {
        return sendConflict(res, 'OEM with this email already exists');
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updateFields.push('name = @name');
      updateRequest.input('name', sql.VarChar(100), name.trim());
    }
    if (code !== undefined) {
      updateFields.push('code = @code');
      updateRequest.input('code', sql.VarChar(20), code);
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateRequest.input('description', sql.VarChar(500), description);
    }
    if (contact_person !== undefined) {
      updateFields.push('contact_person = @contactPerson');
      updateRequest.input('contactPerson', sql.VarChar(100), contact_person);
    }
    if (email !== undefined) {
      updateFields.push('email = @email');
      updateRequest.input('email', sql.VarChar(255), email ? email.toLowerCase() : null);
    }
    if (phone !== undefined) {
      updateFields.push('phone = @phone');
      updateRequest.input('phone', sql.VarChar(20), phone);
    }
    if (website !== undefined) {
      updateFields.push('website = @website');
      updateRequest.input('website', sql.VarChar(255), website);
    }
    if (address !== undefined) {
      updateFields.push('address = @address');
      updateRequest.input('address', sql.VarChar(500), address);
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
      UPDATE oems 
      SET ${updateFields.join(', ')}
      WHERE id = @id;
      
      SELECT id, name, code, description, contact_person, email, phone, website, address, is_active, created_at, updated_at
      FROM oems WHERE id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'OEM updated successfully');
  })
);

// DELETE /masters/oem/:id - Delete OEM
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if OEM exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM oems WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'OEM not found');
    }

    // Check if OEM is referenced by any products
    const referencesResult = await pool.request()
      .input('oemId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM products WHERE oem_id = @oemId');

    if (referencesResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete OEM. It is referenced by existing products.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE oems 
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'OEM deleted successfully');
  })
);

// GET /masters/oem/:id/products - Get products for an OEM
router.get('/:id/products',
  requireDynamicPermission(),
  validateUUID('id'),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit, offset } = req.pagination;

    const pool = await connectDB();

    // Check if OEM exists
    const oemResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT name FROM oems WHERE id = @id');

    if (oemResult.recordset.length === 0) {
      return sendNotFound(res, 'OEM not found');
    }

    // Get total count of products for this OEM
    const countResult = await pool.request()
      .input('oemId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as total FROM products WHERE oem_id = @oemId AND is_active = 1');

    const total = countResult.recordset[0].total;

    // Get paginated products
    const result = await pool.request()
      .input('oemId', sql.UniqueIdentifier, id)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT p.id, p.name, p.description, p.model, p.warranty_period,
               c.name as category_name, sc.name as subcategory_name,
               p.created_at, p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories sc ON p.subcategory_id = sc.id
        WHERE p.oem_id = @oemId AND p.is_active = 1
        ORDER BY p.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      oem: oemResult.recordset[0],
      products: result.recordset,
      pagination
    }, 'OEM products retrieved successfully');
  })
);

module.exports = router;