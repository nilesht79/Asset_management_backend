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

// GET /masters/clients - List all clients with pagination and search
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
      whereClause += ' AND (client_name LIKE @search OR client_code LIKE @search OR contact_person LIKE @search)';
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
      FROM clients
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['client_name', 'client_code', 'contact_person', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'client_name';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT c.id, c.client_name, c.client_code, c.contact_person, c.contact_email, c.contact_phone,
             c.address, c.is_active, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM locations WHERE client_id = c.id AND is_active = 1) as locations_count
      FROM clients c
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      clients: result.recordset,
      pagination
    }, 'Clients retrieved successfully');
  })
);

// GET /masters/clients/dropdown - Get clients for dropdown
router.get('/dropdown',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    
    const result = await pool.request().query(`
      SELECT id, client_name as label, id as value, client_code
      FROM clients
      WHERE is_active = 1
      ORDER BY client_name
    `);

    sendSuccess(res, result.recordset, 'Clients dropdown retrieved successfully');
  })
);

// GET /masters/clients/:id - Get client by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT c.id, c.client_name, c.client_code, c.contact_person, c.contact_email, c.contact_phone,
               c.address, c.is_active, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM locations WHERE client_id = c.id AND is_active = 1) as locations_count
        FROM clients c
        WHERE c.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Client not found');
    }

    sendSuccess(res, result.recordset[0], 'Client retrieved successfully');
  })
);

// POST /masters/clients - Create new client
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.client.create),
  asyncHandler(async (req, res) => {
    const { client_name, client_code, contact_person, contact_email, contact_phone, address, is_active = true } = req.body;

    const pool = await connectDB();
    
    // Check if client with same name already exists
    const existingResult = await pool.request()
      .input('clientName', sql.VarChar(200), client_name.trim())
      .query('SELECT id FROM clients WHERE LOWER(client_name) = LOWER(@clientName)');

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Client with this name already exists');
    }

    // Check if client code is provided and unique
    if (client_code) {
      const codeResult = await pool.request()
        .input('clientCode', sql.VarChar(20), client_code.trim())
        .query('SELECT id FROM clients WHERE client_code = @clientCode');

      if (codeResult.recordset.length > 0) {
        return sendConflict(res, 'Client code already exists');
      }
    }

    const clientId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, clientId)
      .input('clientName', sql.VarChar(200), client_name.trim())
      .input('clientCode', sql.VarChar(20), client_code?.trim() || null)
      .input('contactPerson', sql.VarChar(100), contact_person?.trim() || null)
      .input('contactEmail', sql.VarChar(255), contact_email?.trim() || null)
      .input('contactPhone', sql.VarChar(20), contact_phone?.trim() || null)
      .input('address', sql.VarChar(500), address?.trim() || null)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO clients (id, client_name, client_code, contact_person, contact_email, contact_phone, address, is_active, created_at, updated_at)
        VALUES (@id, @clientName, @clientCode, @contactPerson, @contactEmail, @contactPhone, @address, @isActive, GETUTCDATE(), GETUTCDATE());
        
        SELECT id, client_name, client_code, contact_person, contact_email, contact_phone, address, is_active, created_at, updated_at
        FROM clients
        WHERE id = @id;
      `);

    sendCreated(res, result.recordset[0], 'Client created successfully');
  })
);

// PUT /masters/clients/:id - Update client
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.client.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { client_name, client_code, contact_person, contact_email, contact_phone, address, is_active } = req.body;

    const pool = await connectDB();
    
    // Check if client exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT client_name, client_code FROM clients WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Client not found');
    }

    const existing = existingResult.recordset[0];

    // Check for name conflicts if name is being updated
    if (client_name && client_name.trim() !== existing.client_name) {
      const conflictResult = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('clientName', sql.VarChar(200), client_name.trim())
        .query('SELECT id FROM clients WHERE LOWER(client_name) = LOWER(@clientName) AND id != @id');

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Client with this name already exists');
      }
    }

    // Check for code conflicts if code is being updated
    if (client_code && client_code.trim() !== existing.client_code) {
      const codeConflictResult = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('clientCode', sql.VarChar(20), client_code.trim())
        .query('SELECT id FROM clients WHERE client_code = @clientCode AND id != @id');

      if (codeConflictResult.recordset.length > 0) {
        return sendConflict(res, 'Client code already exists');
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (client_name !== undefined) {
      updateFields.push('client_name = @clientName');
      updateRequest.input('clientName', sql.VarChar(200), client_name.trim());
    }
    if (client_code !== undefined) {
      updateFields.push('client_code = @clientCode');
      updateRequest.input('clientCode', sql.VarChar(20), client_code?.trim() || null);
    }
    if (contact_person !== undefined) {
      updateFields.push('contact_person = @contactPerson');
      updateRequest.input('contactPerson', sql.VarChar(100), contact_person?.trim() || null);
    }
    if (contact_email !== undefined) {
      updateFields.push('contact_email = @contactEmail');
      updateRequest.input('contactEmail', sql.VarChar(255), contact_email?.trim() || null);
    }
    if (contact_phone !== undefined) {
      updateFields.push('contact_phone = @contactPhone');
      updateRequest.input('contactPhone', sql.VarChar(20), contact_phone?.trim() || null);
    }
    if (address !== undefined) {
      updateFields.push('address = @address');
      updateRequest.input('address', sql.VarChar(500), address?.trim() || null);
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
      UPDATE clients 
      SET ${updateFields.join(', ')}
      WHERE id = @id;
      
      SELECT id, client_name, client_code, contact_person, contact_email, contact_phone, address, is_active, created_at, updated_at
      FROM clients
      WHERE id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'Client updated successfully');
  })
);

// DELETE /masters/clients/:id - Delete client
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if client exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM clients WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Client not found');
    }

    // Check if client is being used by locations
    const locationsResult = await pool.request()
      .input('clientId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM locations WHERE client_id = @clientId AND is_active = 1');

    if (locationsResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete client. It is being used by active locations.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE clients 
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Client deleted successfully');
  })
);

module.exports = router;