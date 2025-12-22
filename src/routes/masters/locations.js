const express = require('express');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const validators = require('../../utils/validators');
const { upload } = require('../../middleware/upload');
const { generateLocationBulkTemplate } = require('../../utils/excel-template');

const router = express.Router();

// GET /masters/locations - List all locations with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, parent_id, type, city, state } = req.query;

    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (l.name LIKE @search OR l.address LIKE @search OR l.contact_person LIKE @search OR l.city_name LIKE @search OR l.state_name LIKE @search OR l.id LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND l.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (type) {
      whereClause += ' AND l.location_type_id = @type';
      params.push({ name: 'type', type: sql.VarChar(50), value: type });
    }

    if (city) {
      whereClause += ' AND l.city_name = @city';
      params.push({ name: 'city', type: sql.VarChar(100), value: city });
    }

    if (state) {
      whereClause += ' AND l.state_name = @state';
      params.push({ name: 'state', type: sql.VarChar(100), value: state });
    }

    if (parent_id === 'null' || parent_id === null) {
      whereClause += ' AND l.parent_location_id IS NULL';
    } else if (parent_id) {
      whereClause += ' AND l.parent_location_id = @parentId';
      params.push({ name: 'parentId', type: sql.UniqueIdentifier, value: parent_id });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM locations l
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'address', 'city_name', 'state_name', 'pincode', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `l.${sortBy}` : 'l.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT
        l.id, l.name, l.address,
        l.state_name, l.city_name, l.pincode, l.area_name,
        l.building, l.floor,
        l.contact_person, l.contact_email, l.contact_phone,
        l.client_id, l.location_type_id,
        l.parent_location_id, pl.name as parent_location_name,
        c.client_name, lt.location_type,
        l.is_active, l.created_at, l.updated_at,
        (SELECT COUNT(*) FROM locations WHERE parent_location_id = l.id AND is_active = 1) as sub_location_count,
        (SELECT COUNT(*)
         FROM assets a
         INNER JOIN USER_MASTER u ON a.assigned_to = u.user_id
         WHERE u.location_id = l.id AND a.is_active = 1) as asset_count
      FROM locations l
      LEFT JOIN locations pl ON l.parent_location_id = pl.id
      LEFT JOIN clients c ON l.client_id = c.id
      LEFT JOIN location_types lt ON l.location_type_id = lt.id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      locations: result.recordset,
      pagination
    }, 'Locations retrieved successfully');
  })
);

// GET /masters/locations/dropdown - Get locations for dropdown
router.get('/dropdown',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { type, city, state, status } = req.query;
    const pool = await connectDB();

    const request = pool.request();
    let query = `
      SELECT l.id, l.name as label, l.id as value,
             l.id, l.location_type_id, l.city_name, l.state_name, l.pincode,
             l.building, l.floor
      FROM locations l
      WHERE l.is_active = 1
    `;

    if (status) {
      query += status === 'active' ? ' AND l.is_active = 1' : ' AND l.is_active = 0';
    }

    if (type) {
      query += ' AND l.location_type_id = @type';
      request.input('type', sql.VarChar(50), type);
    }

    if (city) {
      query += ' AND l.city_name = @city';
      request.input('city', sql.VarChar(100), city);
    }

    if (state) {
      query += ' AND l.state_name = @state';
      request.input('state', sql.VarChar(100), state);
    }

    query += ' ORDER BY l.name';

    const result = await request.query(query);

    sendSuccess(res, result.recordset, 'Locations dropdown retrieved successfully');
  })
);

// GET /masters/locations/bulk-template - Download location bulk upload template
router.get('/bulk-template',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    // Fetch all active clients
    const clientsResult = await pool.request().query(`
      SELECT id, client_name, is_active
      FROM clients
      WHERE is_active = 1
      ORDER BY client_name
    `);

    // Fetch all active location types
    const typesResult = await pool.request().query(`
      SELECT id, location_type, description, is_active
      FROM location_types
      WHERE is_active = 1
      ORDER BY location_type
    `);

    // Generate template
    const buffer = await generateLocationBulkTemplate({
      clients: clientsResult.recordset,
      locationTypes: typesResult.recordset
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=location_bulk_upload_template.xlsx');
    res.send(buffer);
  })
);

// POST /masters/locations/bulk-upload - Upload and process location bulk upload
router.post('/bulk-upload',
  requireDynamicPermission(),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const pool = await connectDB();

    // Parse Excel file
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.getWorksheet('Locations');
    if (!worksheet) {
      return sendError(res, 'Locations worksheet not found in file', 400);
    }

    // Fetch reference data
    const [clientsResult, typesResult, existingLocationsResult] = await Promise.all([
      pool.request().query('SELECT id, client_name FROM clients WHERE is_active = 1'),
      pool.request().query('SELECT id, location_type FROM location_types WHERE is_active = 1'),
      pool.request().query('SELECT LOWER(name) as name, LOWER(contact_email) as contact_email FROM locations')
    ]);

    const clientsByName = new Map();
    const clientsById = new Map();
    clientsResult.recordset.forEach(c => {
      clientsByName.set(c.client_name.toLowerCase().trim(), c);
      clientsById.set(c.id.toLowerCase(), c);
    });

    const typesByName = new Map();
    const typesById = new Map();
    typesResult.recordset.forEach(t => {
      typesByName.set(t.location_type.toLowerCase().trim(), t);
      typesById.set(t.id.toLowerCase(), t);
    });

    const existingNames = new Set(existingLocationsResult.recordset.map(l => l.name));
    const existingEmails = new Set(existingLocationsResult.recordset.map(l => l.contact_email));

    const results = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process rows
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 1) return; // Skip header
      rows.push({ row, rowNumber });
    });

    results.total = rows.length;

    for (const { row, rowNumber } of rows) {
      try {
        const locationData = {
          name: row.getCell(2).value?.toString().trim() || '',
          address: row.getCell(3).value?.toString().trim() || '',
          client_input: row.getCell(4).value?.toString().trim() || '',
          type_input: row.getCell(5).value?.toString().trim() || '',
          contact_person: row.getCell(6).value?.toString().trim() || '',
          contact_email: row.getCell(7).value?.toString().trim() || '',
          contact_phone: row.getCell(8).value?.toString().trim() || null,
          state_name: row.getCell(9).value?.toString().trim() || null,
          city_name: row.getCell(10).value?.toString().trim() || null,
          area_name: row.getCell(11).value?.toString().trim() || null,
          pincode: row.getCell(12).value?.toString().trim() || null,
          parent_location_input: row.getCell(13).value?.toString().trim() || null
        };

        // Validate required fields
        if (!locationData.name || !locationData.address || !locationData.client_input ||
            !locationData.type_input || !locationData.contact_person || !locationData.contact_email) {
          throw new Error('Missing required fields');
        }

        // Check for duplicates
        if (existingNames.has(locationData.name.toLowerCase())) {
          throw new Error(`Location name already exists: ${locationData.name}`);
        }

        if (existingEmails.has(locationData.contact_email.toLowerCase())) {
          throw new Error(`Contact email already exists: ${locationData.contact_email}`);
        }

        // Match client
        const client = clientsById.get(locationData.client_input.toLowerCase()) ||
                      clientsByName.get(locationData.client_input.toLowerCase());
        if (!client) {
          throw new Error(`Client not found: ${locationData.client_input}`);
        }

        // Match location type
        const locationType = typesById.get(locationData.type_input.toLowerCase()) ||
                            typesByName.get(locationData.type_input.toLowerCase());
        if (!locationType) {
          throw new Error(`Location type not found: ${locationData.type_input}`);
        }

        // Find parent location if specified
        let parentLocationId = null;
        if (locationData.parent_location_input) {
          const parentResult = await pool.request()
            .input('parentName', sql.VarChar(255), locationData.parent_location_input)
            .query('SELECT id FROM locations WHERE name = @parentName AND is_active = 1');

          if (parentResult.recordset.length === 0) {
            throw new Error(`Parent location not found: ${locationData.parent_location_input}`);
          }
          parentLocationId = parentResult.recordset[0].id;
        }

        // Insert location
        await pool.request()
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('name', sql.VarChar(255), locationData.name)
          .input('address', sql.NVarChar(sql.MAX), locationData.address)
          .input('clientId', sql.UniqueIdentifier, client.id)
          .input('locationTypeId', sql.UniqueIdentifier, locationType.id)
          .input('contactPerson', sql.VarChar(255), locationData.contact_person)
          .input('contactEmail', sql.VarChar(255), locationData.contact_email)
          .input('contactPhone', sql.VarChar(50), locationData.contact_phone)
          .input('stateName', sql.VarChar(100), locationData.state_name)
          .input('cityName', sql.VarChar(100), locationData.city_name)
          .input('areaName', sql.VarChar(100), locationData.area_name)
          .input('pincode', sql.VarChar(20), locationData.pincode)
          .input('parentLocationId', sql.UniqueIdentifier, parentLocationId)
          .query(`
            INSERT INTO locations (
              id, name, address, client_id, location_type_id,
              contact_person, contact_email, contact_phone,
              state_name, city_name, area_name, pincode,
              parent_location_id, is_active, created_at, updated_at
            )
            VALUES (
              @id, @name, @address, @clientId, @locationTypeId,
              @contactPerson, @contactEmail, @contactPhone,
              @stateName, @cityName, @areaName, @pincode,
              @parentLocationId, 1, GETUTCDATE(), GETUTCDATE()
            )
          `);

        // Add to existing sets to catch duplicates within file
        existingNames.add(locationData.name.toLowerCase());
        existingEmails.add(locationData.contact_email.toLowerCase());

        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          error: error.message
        });
      }
    }

    return sendSuccess(res, results, 'Location bulk upload completed');
  })
);

// GET /masters/locations/export - Export locations to Excel
router.get('/export',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { format = 'xlsx', search, status, city, state } = req.query;

    const pool = await connectDB();

    // Build WHERE clause for export
    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (l.name LIKE @search OR l.address LIKE @search OR l.contact_person LIKE @search OR l.city_name LIKE @search OR l.state_name LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND l.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (city) {
      whereClause += ' AND l.city_name = @city';
      params.push({ name: 'city', type: sql.VarChar(100), value: city });
    }

    if (state) {
      whereClause += ' AND l.state_name = @state';
      params.push({ name: 'state', type: sql.VarChar(100), value: state });
    }

    // Get all locations for export (no pagination)
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        l.id, l.name, l.address,
        l.state_name, l.city_name, l.pincode, l.area_name,
        l.building, l.floor,
        l.contact_person, l.contact_email, l.contact_phone,
        c.client_name, lt.location_type,
        l.is_active, l.created_at, l.updated_at
      FROM locations l
      LEFT JOIN clients c ON l.client_id = c.id
      LEFT JOIN location_types lt ON l.location_type_id = lt.id
      WHERE ${whereClause}
      ORDER BY l.created_at DESC
    `);

    if (format === 'xlsx') {
      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Locations');

      // Add headers
      worksheet.columns = [
        { header: 'Location ID', key: 'id', width: 10 },
        { header: 'Location Name', key: 'name', width: 30 },
        { header: 'Client', key: 'client_name', width: 25 },
        { header: 'Location Type', key: 'location_type', width: 20 },
        { header: 'State', key: 'state', width: 20 },
        { header: 'City', key: 'city', width: 20 },
        { header: 'Pincode', key: 'pincode', width: 12 },
        { header: 'Area', key: 'area', width: 25 },
        { header: 'Building', key: 'building', width: 20 },
        { header: 'Floor', key: 'floor', width: 12 },
        { header: 'Address', key: 'address', width: 40 },
        { header: 'Contact Person', key: 'contact_person', width: 25 },
        { header: 'Contact Email', key: 'contact_email', width: 30 },
        { header: 'Contact Phone', key: 'contact_phone', width: 20 },
        { header: 'Status', key: 'is_active', width: 12 },
        { header: 'Created Date', key: 'created_at', width: 20 }
      ];

      // Style headers
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      result.recordset.forEach((location, index) => {
        worksheet.addRow({
          id: String(index + 1).padStart(2, '0'),
          name: location.name,
          client_name: location.client_name || '',
          location_type: location.location_type || '',
          state: location.state_name || '',
          city: location.city_name || '',
          pincode: location.pincode || '',
          area: location.area_name || '',
          building: location.building || '',
          floor: location.floor || '',
          address: location.address || '',
          contact_person: location.contact_person || '',
          contact_email: location.contact_email || '',
          contact_phone: location.contact_phone || '',
          is_active: location.is_active ? 'Active' : 'Inactive',
          created_at: location.created_at ? new Date(location.created_at).toLocaleDateString() : ''
        });
      });

      // Set response headers for download
      const fileName = `locations_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      // Write to response
      await workbook.xlsx.write(res);
      res.end();
    } else {
      return sendError(res, 'Invalid export format. Only xlsx is supported.', 400);
    }
  })
);

// GET /masters/locations/:id - Get location by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          l.id, l.name, l.address, l.client_id, l.location_type_id,
          l.city_name, l.state_name, l.area_name, l.pincode,
          l.building, l.floor,
          l.contact_person, l.contact_email, l.contact_phone,
          l.parent_location_id, pl.name as parent_location_name,
          c.client_name, lt.location_type,
          l.is_active, l.created_at, l.updated_at,
          (SELECT COUNT(*) FROM locations WHERE parent_location_id = l.id AND is_active = 1) as sub_location_count,
          (SELECT COUNT(*) FROM assets WHERE location_id = l.id AND is_active = 1) as asset_count
        FROM locations l
        LEFT JOIN locations pl ON l.parent_location_id = pl.id
        LEFT JOIN clients c ON l.client_id = c.id
        LEFT JOIN location_types lt ON l.location_type_id = lt.id
        WHERE l.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Location not found');
    }

    sendSuccess(res, result.recordset[0], 'Location retrieved successfully');
  })
);

// POST /masters/locations - Create new location
router.post('/',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const {
      name,
      address,
      client_id,
      location_type_id,
      contact_person,
      contact_email,
      contact_phone,
      state_name,
      city_name,
      pincode,
      area_name,
      building,
      floor,
      parent_location_id,
      is_active = true
    } = req.body;

    // Validate required fields
    if (!name || !address || !client_id || !location_type_id || !contact_person || !contact_email) {
      return sendError(res, 'Missing required fields: name, address, client_id, location_type_id, contact_person, contact_email', 400);
    }

    const pool = await connectDB();

    // Check if parent location exists (if provided)
    if (parent_location_id) {
      const parentResult = await pool.request()
        .input('parentId', sql.UniqueIdentifier, parent_location_id)
        .query('SELECT id FROM locations WHERE id = @parentId AND is_active = 1');

      if (parentResult.recordset.length === 0) {
        return sendNotFound(res, 'Parent location not found or inactive');
      }
    }

    // Check if client exists
    const clientResult = await pool.request()
      .input('clientId', sql.UniqueIdentifier, client_id)
      .query('SELECT id FROM clients WHERE id = @clientId AND is_active = 1');

    if (clientResult.recordset.length === 0) {
      return sendNotFound(res, 'Client not found or inactive');
    }

    // Check if location type exists
    const typeResult = await pool.request()
      .input('locationTypeId', sql.UniqueIdentifier, location_type_id)
      .query('SELECT id FROM location_types WHERE id = @locationTypeId AND is_active = 1');

    if (typeResult.recordset.length === 0) {
      return sendNotFound(res, 'Location type not found or inactive');
    }

    // Create the location
    const locationId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, locationId)
      .input('name', sql.VarChar(100), name.trim())
      .input('address', sql.VarChar(500), address.trim())
      .input('clientId', sql.UniqueIdentifier, client_id)
      .input('locationTypeId', sql.UniqueIdentifier, location_type_id)
      .input('contactPerson', sql.VarChar(100), contact_person.trim())
      .input('contactEmail', sql.VarChar(255), contact_email.trim())
      .input('contactPhone', sql.VarChar(20), contact_phone?.trim() || null)
      .input('stateName', sql.VarChar(100), state_name?.trim() || null)
      .input('cityName', sql.VarChar(100), city_name?.trim() || null)
      .input('pincode', sql.VarChar(10), pincode?.trim() || null)
      .input('areaName', sql.VarChar(200), area_name?.trim() || null)
      .input('building', sql.VarChar(100), building?.trim() || null)
      .input('floor', sql.VarChar(50), floor?.trim() || null)
      .input('parentLocationId', sql.UniqueIdentifier, parent_location_id || null)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO locations (
          id, name, address, client_id, location_type_id,
          contact_person, contact_email, contact_phone,
          state_name, city_name, pincode, area_name,
          building, floor,
          parent_location_id, is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @address, @clientId, @locationTypeId,
          @contactPerson, @contactEmail, @contactPhone,
          @stateName, @cityName, @pincode, @areaName,
          @building, @floor,
          @parentLocationId, @isActive, GETUTCDATE(), GETUTCDATE()
        );

        SELECT
          l.id, l.name, l.address, l.client_id, l.location_type_id,
          l.state_name, l.city_name, l.pincode, l.area_name,
          l.building, l.floor,
          l.contact_person, l.contact_email, l.contact_phone,
          l.parent_location_id, pl.name as parent_location_name,
          c.client_name, lt.location_type,
          l.is_active, l.created_at, l.updated_at
        FROM locations l
        LEFT JOIN locations pl ON l.parent_location_id = pl.id
        LEFT JOIN clients c ON l.client_id = c.id
        LEFT JOIN location_types lt ON l.location_type_id = lt.id
        WHERE l.id = @id;
      `);

    sendCreated(res, result.recordset[0], 'Location created successfully');
  })
);

// PUT /masters/locations/:id - Update location
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const pool = await connectDB();

    // Check if location exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM locations WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Location not found');
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    const fieldMapping = {
      name: { type: sql.VarChar(100), dbField: 'name' },
      address: { type: sql.VarChar(500), dbField: 'address' },
      client_id: { type: sql.UniqueIdentifier, dbField: 'client_id' },
      location_type_id: { type: sql.UniqueIdentifier, dbField: 'location_type_id' },
      contact_person: { type: sql.VarChar(100), dbField: 'contact_person' },
      contact_email: { type: sql.VarChar(255), dbField: 'contact_email' },
      contact_phone: { type: sql.VarChar(20), dbField: 'contact_phone' },
      state_name: { type: sql.VarChar(100), dbField: 'state_name' },
      city_name: { type: sql.VarChar(100), dbField: 'city_name' },
      pincode: { type: sql.VarChar(10), dbField: 'pincode' },
      area_name: { type: sql.VarChar(200), dbField: 'area_name' },
      building: { type: sql.VarChar(100), dbField: 'building' },
      floor: { type: sql.VarChar(50), dbField: 'floor' },
      parent_location_id: { type: sql.UniqueIdentifier, dbField: 'parent_location_id' },
      is_active: { type: sql.Bit, dbField: 'is_active' }
    };

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && fieldMapping[key]) {
        const field = fieldMapping[key];
        updateFields.push(`${field.dbField} = @${key}`);
        updateRequest.input(key, field.type, typeof updateData[key] === 'string' ? updateData[key].trim() : updateData[key]);
      }
    });

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const result = await updateRequest.query(`
      UPDATE locations
      SET ${updateFields.join(', ')}
      WHERE id = @id;

      SELECT
        l.id, l.name, l.address, l.client_id, l.location_type_id,
        l.state_name, l.city_name, l.pincode, l.area_name,
        l.building, l.floor,
        l.contact_person, l.contact_email, l.contact_phone,
        l.parent_location_id, pl.name as parent_location_name,
        c.client_name, lt.location_type,
        l.is_active, l.created_at, l.updated_at
      FROM locations l
      LEFT JOIN locations pl ON l.parent_location_id = pl.id
      LEFT JOIN clients c ON l.client_id = c.id
      LEFT JOIN location_types lt ON l.location_type_id = lt.id
      WHERE l.id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'Location updated successfully');
  })
);

// DELETE /masters/locations/:id - Delete location
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if location exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM locations WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Location not found');
    }

    // Check if location has sub-locations
    const subLocationsResult = await pool.request()
      .input('parentId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM locations WHERE parent_location_id = @parentId AND is_active = 1');

    if (subLocationsResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete location. It has active sub-locations.');
    }

    // Check if location has assets (via assigned users)
    const assetsResult = await pool.request()
      .input('locationId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM assets a INNER JOIN USER_MASTER u ON a.assigned_to = u.user_id WHERE u.location_id = @locationId AND a.is_active = 1');

    if (assetsResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete location. It has active assets.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE locations
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Location deleted successfully');
  })
);
module.exports = router;
