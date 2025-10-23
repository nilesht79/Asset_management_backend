const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const validators = require('../../utils/validators');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/temp/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV and Excel files are allowed.'));
    }
  }
});

// GET /masters/products/statistics - Get product statistics
router.get('/statistics',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const statsQuery = `
      SELECT
        COUNT(*) as total_products,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_products,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_products
      FROM products
    `;

    const result = await pool.request().query(statsQuery);
    const stats = result.recordset[0];

    // Get total assets count (count of assets linked to products)
    const assetsQuery = `
      SELECT COUNT(*) as total_assets
      FROM assets
      WHERE product_id IS NOT NULL
    `;

    const assetsResult = await pool.request().query(assetsQuery);
    const totalAssets = assetsResult.recordset[0].total_assets || 0;

    sendSuccess(res, {
      total: stats.total_products || 0,
      active: stats.active_products || 0,
      inactive: stats.inactive_products || 0,
      totalAssets: totalAssets
    });
  })
);

// GET /masters/products - List all products with pagination and search
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, category_id, oem_id } = req.query;

    const pool = await connectDB();
    
    // Build WHERE clause
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (p.name LIKE @search OR p.description LIKE @search OR p.model LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }
    
    if (status) {
      whereClause += ' AND p.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (category_id) {
      whereClause += ' AND p.category_id = @categoryId';
      params.push({ name: 'categoryId', type: sql.UniqueIdentifier, value: category_id });
    }

    if (oem_id) {
      whereClause += ' AND p.oem_id = @oemId';
      params.push({ name: 'oemId', type: sql.UniqueIdentifier, value: oem_id });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM products p
      WHERE ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['name', 'model', 'warranty_period', 'created_at', 'updated_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `p.${sortBy}` : 'p.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT p.id, p.name, p.description, p.model, p.type_id, p.category_id, p.subcategory_id,
             p.oem_id, p.series_id, p.specifications, p.warranty_period,
             p.capacity_value, p.capacity_unit, p.speed_value, p.speed_unit,
             p.interface_type, p.form_factor, p.is_active,
             p.created_at, p.updated_at,
             pt.name as type_name,
             pc.name as category_name,
             psc.name as subcategory_name,
             ps.name as series_name,
             o.name as oem_name,
             (SELECT COUNT(*) FROM assets WHERE product_id = p.id AND is_active = 1) as asset_count
      FROM products p
      LEFT JOIN product_types pt ON p.type_id = pt.id
      LEFT JOIN categories pc ON p.category_id = pc.id
      LEFT JOIN categories psc ON p.subcategory_id = psc.id
      LEFT JOIN product_series ps ON p.series_id = ps.id
      LEFT JOIN oems o ON p.oem_id = o.id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      products: result.recordset,
      pagination
    }, 'Products retrieved successfully');
  })
);

// GET /masters/products/bulk-upload/template - Download template file
router.get('/bulk-upload/template',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    // Create sample template data
    const templateData = [
      {
        name: 'Kingston HyperX Fury 16GB DDR4 3200MHz',
        model: 'HX432C16FB3/16',
        description: '16GB DDR4 Desktop RAM Module',
        type: 'RAM/Memory',
        category: 'DDR4 Memory',
        subcategory: 'Desktop RAM',
        oem: 'Kingston',
        series: 'HyperX Fury',
        capacity_value: 16,
        capacity_unit: 'GB',
        speed_value: 3200,
        speed_unit: 'MHz',
        interface_type: 'DDR4',
        form_factor: 'DIMM',
        specifications: 'Non-ECC, CL16, 1.35V, Black heatspreader',
        warranty_period: 36
      },
      {
        name: 'Intel Core i7-13700K',
        model: 'BX8071513700K',
        description: '13th Gen Desktop Processor',
        type: 'Processor/CPU',
        category: 'Desktop Processor',
        subcategory: '',
        oem: 'Intel',
        series: 'Core i7',
        capacity_value: 16,
        capacity_unit: 'Cores',
        speed_value: 3.4,
        speed_unit: 'GHz',
        interface_type: 'LGA1700',
        form_factor: '',
        specifications: '8P+8E cores, Turbo up to 5.4GHz, 30MB Cache, 125W TDP',
        warranty_period: 36
      },
      {
        name: 'Samsung 980 PRO 1TB',
        model: 'MZ-V8P1T0BW',
        description: '1TB NVMe M.2 SSD',
        type: 'Storage - SSD/NVMe',
        category: 'SSD NVMe',
        subcategory: 'SSD M.2',
        oem: 'Samsung',
        series: '980 PRO',
        capacity_value: 1024,
        capacity_unit: 'GB',
        speed_value: 7000,
        speed_unit: 'MB/s',
        interface_type: 'NVMe',
        form_factor: 'M.2',
        specifications: 'PCIe 4.0 x4, Read: 7000MB/s, Write: 5000MB/s',
        warranty_period: 60
      },
      {
        name: 'Dell OptiPlex 7090 Desktop',
        model: 'OPTIPLEX-7090-MT',
        description: 'Complete Desktop System with i7 processor',
        type: 'Complete System',
        category: 'Desktop Computer',
        subcategory: 'Business Desktop',
        oem: 'Dell',
        series: 'OptiPlex 7000',
        capacity_value: '',
        capacity_unit: '',
        speed_value: '',
        speed_unit: '',
        interface_type: '',
        form_factor: 'Mid Tower',
        specifications: 'Intel i7-11700, 16GB DDR4, 512GB NVMe SSD, Intel UHD Graphics 750, Windows 11 Pro, 3-Year Warranty',
        warranty_period: 36
      },
      {
        name: 'HP Pavilion Gaming Laptop',
        model: 'PAVILION-15-EC2XXX',
        description: 'Gaming Laptop with RTX Graphics',
        type: 'Complete System',
        category: 'Laptop',
        subcategory: 'Gaming Laptop',
        oem: 'HP',
        series: 'Pavilion Gaming',
        capacity_value: '',
        capacity_unit: '',
        speed_value: '',
        speed_unit: '',
        interface_type: '',
        form_factor: '15.6 inch',
        specifications: 'AMD Ryzen 7 5800H, 16GB DDR4, 512GB NVMe SSD, NVIDIA RTX 3060 6GB, 15.6" FHD 144Hz, Windows 11 Home',
        warranty_period: 12
      }
    ];

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');

    // Set column widths
    ws['!cols'] = [
      { wch: 40 }, // name
      { wch: 20 }, // model
      { wch: 35 }, // description
      { wch: 20 }, // type
      { wch: 20 }, // category
      { wch: 20 }, // subcategory
      { wch: 15 }, // oem
      { wch: 20 }, // series
      { wch: 15 }, // capacity_value
      { wch: 15 }, // capacity_unit
      { wch: 12 }, // speed_value
      { wch: 12 }, // speed_unit
      { wch: 15 }, // interface_type
      { wch: 15 }, // form_factor
      { wch: 50 }, // specifications
      { wch: 15 }  // warranty_period
    ];

    // Generate Excel file
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Send file
    res.setHeader('Content-Disposition', 'attachment; filename=products-bulk-upload-template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  })
);

// GET /masters/products/export - Export products to Excel
router.get('/export',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { format = 'xlsx', search, category_id, type_id, oem_id, status } = req.query;

    const pool = await connectDB();

    // Build WHERE clause for export
    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (p.name LIKE @search OR p.model LIKE @search OR p.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (category_id) {
      whereClause += ' AND p.category_id = @category_id';
      params.push({ name: 'category_id', type: sql.UniqueIdentifier, value: category_id });
    }

    if (type_id) {
      whereClause += ' AND p.type_id = @type_id';
      params.push({ name: 'type_id', type: sql.UniqueIdentifier, value: type_id });
    }

    if (oem_id) {
      whereClause += ' AND p.oem_id = @oem_id';
      params.push({ name: 'oem_id', type: sql.UniqueIdentifier, value: oem_id });
    }

    if (status) {
      whereClause += ' AND p.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    // Get all products for export (no pagination)
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        p.id, p.name, p.model, p.description,
        cat.name as category_name,
        subcat.name as subcategory_name,
        pt.name as type_name,
        ps.name as series_name,
        o.name as oem_name,
        p.capacity_value, p.capacity_unit,
        p.speed_value, p.speed_unit,
        p.interface_type, p.form_factor,
        p.specifications, p.warranty_period,
        p.is_active, p.created_at, p.updated_at
      FROM products p
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN categories subcat ON p.subcategory_id = subcat.id
      LEFT JOIN product_types pt ON p.type_id = pt.id
      LEFT JOIN product_series ps ON p.series_id = ps.id
      LEFT JOIN oems o ON p.oem_id = o.id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
    `);

    if (format === 'xlsx') {
      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Products');

      // Add headers
      worksheet.columns = [
        { header: 'Product ID', key: 'id', width: 10 },
        { header: 'Product Name', key: 'name', width: 35 },
        { header: 'Model', key: 'model', width: 25 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Sub-Category', key: 'subcategory', width: 20 },
        { header: 'Type', key: 'type', width: 20 },
        { header: 'Series', key: 'series', width: 20 },
        { header: 'OEM', key: 'oem', width: 20 },
        { header: 'Capacity', key: 'capacity', width: 15 },
        { header: 'Speed', key: 'speed', width: 15 },
        { header: 'Interface', key: 'interface', width: 15 },
        { header: 'Form Factor', key: 'form_factor', width: 15 },
        { header: 'Specifications', key: 'specifications', width: 50 },
        { header: 'Warranty (Months)', key: 'warranty', width: 18 },
        { header: 'Status', key: 'status', width: 12 },
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
      result.recordset.forEach((product, index) => {
        worksheet.addRow({
          id: String(index + 1).padStart(3, '0'),
          name: product.name || '',
          model: product.model || '',
          description: product.description || '',
          category: product.category_name || '',
          subcategory: product.subcategory_name || '',
          type: product.type_name || '',
          series: product.series_name || '',
          oem: product.oem_name || '',
          capacity: product.capacity_value && product.capacity_unit
            ? `${product.capacity_value} ${product.capacity_unit}`
            : '',
          speed: product.speed_value && product.speed_unit
            ? `${product.speed_value} ${product.speed_unit}`
            : '',
          interface: product.interface_type || '',
          form_factor: product.form_factor || '',
          specifications: product.specifications || '',
          warranty: product.warranty_period || '',
          status: product.is_active ? 'Active' : 'Inactive',
          created_at: product.created_at ? new Date(product.created_at).toLocaleDateString() : ''
        });
      });

      // Set response headers for download
      const fileName = `products_export_${new Date().toISOString().split('T')[0]}.xlsx`;
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

// GET /masters/products/:id - Get product by ID
router.get('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT p.id, p.name, p.description, p.model, p.type_id, p.category_id, p.subcategory_id,
               p.oem_id, p.series_id, p.specifications, p.warranty_period,
               p.capacity_value, p.capacity_unit, p.speed_value, p.speed_unit,
               p.interface_type, p.form_factor, p.is_active,
               p.created_at, p.updated_at,
               pt.name as type_name,
               pc.name as category_name,
               psc.name as subcategory_name,
               ps.name as series_name,
               o.name as oem_name, o.contact_person as oem_contact, o.email as oem_email,
               (SELECT COUNT(*) FROM assets WHERE product_id = p.id AND is_active = 1) as asset_count
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.id
        LEFT JOIN categories pc ON p.category_id = pc.id
        LEFT JOIN categories psc ON p.subcategory_id = psc.id
        LEFT JOIN product_series ps ON p.series_id = ps.id
        LEFT JOIN oems o ON p.oem_id = o.id
        WHERE p.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Product not found');
    }

    sendSuccess(res, result.recordset[0], 'Product retrieved successfully');
  })
);

// POST /masters/products - Create new product
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.product.create),
  asyncHandler(async (req, res) => {
    const {
      name,
      description,
      model,
      type_id,
      category_id,
      subcategory_id,
      oem_id,
      series_id,
      specifications,
      warranty_period,
      capacity_value,
      capacity_unit,
      speed_value,
      speed_unit,
      interface_type,
      form_factor,
      is_active = true
    } = req.body;

    const pool = await connectDB();
    
    // Check if product with same name and model already exists for this OEM
    const existingResult = await pool.request()
      .input('name', sql.VarChar(200), name.trim())
      .input('model', sql.VarChar(100), model)
      .input('oemId', sql.UniqueIdentifier, oem_id)
      .query(`
        SELECT id FROM products 
        WHERE LOWER(name) = LOWER(@name) 
        AND LOWER(model) = LOWER(@model) 
        AND oem_id = @oemId
      `);

    if (existingResult.recordset.length > 0) {
      return sendConflict(res, 'Product with this name and model already exists for this OEM');
    }

    // Verify that referenced entities exist
    const referencesResult = await pool.request()
      .input('categoryId', sql.UniqueIdentifier, category_id)
      .input('subcategoryId', sql.UniqueIdentifier, subcategory_id)
      .input('oemId', sql.UniqueIdentifier, oem_id)
      .input('seriesId', sql.UniqueIdentifier, series_id)
      .query(`
        SELECT 
          (SELECT COUNT(*) FROM categories WHERE id = @categoryId) as category_exists,
          (SELECT COUNT(*) FROM categories WHERE id = @subcategoryId) as subcategory_exists,
          (SELECT COUNT(*) FROM oems WHERE id = @oemId) as oem_exists,
          (SELECT COUNT(*) FROM product_series WHERE id = @seriesId) as series_exists
      `);

    const refs = referencesResult.recordset[0];

    if (refs.category_exists === 0) {
      return sendNotFound(res, 'Category not found or inactive');
    }

    if (subcategory_id && refs.subcategory_exists === 0) {
      return sendNotFound(res, 'Subcategory not found or inactive');
    }

    if (refs.oem_exists === 0) {
      return sendNotFound(res, 'OEM not found or inactive');
    }

    if (series_id && refs.series_exists === 0) {
      return sendNotFound(res, 'Series not found or inactive');
    }

    // If subcategory is provided, verify it belongs to the category
    if (subcategory_id) {
      const subcatResult = await pool.request()
        .input('subcategoryId', sql.UniqueIdentifier, subcategory_id)
        .input('categoryId', sql.UniqueIdentifier, category_id)
        .query(`
          SELECT id FROM categories 
          WHERE id = @subcategoryId AND parent_category_id = @categoryId
        `);

      if (subcatResult.recordset.length === 0) {
        return sendError(res, 'Subcategory does not belong to the specified category', 400);
      }
    }

    const productId = uuidv4();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, productId)
      .input('name', sql.VarChar(200), name.trim())
      .input('description', sql.VarChar(1000), description)
      .input('model', sql.VarChar(100), model)
      .input('typeId', sql.UniqueIdentifier, type_id)
      .input('categoryId', sql.UniqueIdentifier, category_id)
      .input('subcategoryId', sql.UniqueIdentifier, subcategory_id)
      .input('oemId', sql.UniqueIdentifier, oem_id)
      .input('seriesId', sql.UniqueIdentifier, series_id)
      .input('specifications', sql.NVarChar(sql.MAX), specifications || null)
      .input('warrantyPeriod', sql.Int, warranty_period)
      .input('capacityValue', sql.Decimal(10, 2), capacity_value)
      .input('capacityUnit', sql.VarChar(20), capacity_unit)
      .input('speedValue', sql.Decimal(10, 2), speed_value)
      .input('speedUnit', sql.VarChar(20), speed_unit)
      .input('interfaceType', sql.VarChar(50), interface_type)
      .input('formFactor', sql.VarChar(50), form_factor)
      .input('isActive', sql.Bit, is_active)
      .query(`
        INSERT INTO products (
          id, name, description, model, type_id, category_id, subcategory_id, oem_id, series_id,
          specifications, warranty_period, capacity_value, capacity_unit, speed_value, speed_unit,
          interface_type, form_factor, is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @description, @model, @typeId, @categoryId, @subcategoryId, @oemId, @seriesId,
          @specifications, @warrantyPeriod, @capacityValue, @capacityUnit, @speedValue, @speedUnit,
          @interfaceType, @formFactor, @isActive, GETUTCDATE(), GETUTCDATE()
        );

        SELECT p.id, p.name, p.description, p.model, p.type_id, p.category_id, p.subcategory_id,
               p.oem_id, p.series_id, p.specifications, p.warranty_period,
               p.capacity_value, p.capacity_unit, p.speed_value, p.speed_unit,
               p.interface_type, p.form_factor, p.is_active,
               p.created_at, p.updated_at,
               pt.name as type_name,
               pc.name as category_name,
               psc.name as subcategory_name,
               ps.name as series_name,
               o.name as oem_name
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.id
        LEFT JOIN categories pc ON p.category_id = pc.id
        LEFT JOIN categories psc ON p.subcategory_id = psc.id
        LEFT JOIN product_series ps ON p.series_id = ps.id
        LEFT JOIN oems o ON p.oem_id = o.id
        WHERE p.id = @id;
      `);

    const product = result.recordset[0];

    sendCreated(res, product, 'Product created successfully');
  })
);

// PUT /masters/products/:id - Update product
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.product.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      name,
      description,
      model,
      type_id,
      category_id,
      subcategory_id,
      oem_id,
      series_id,
      specifications,
      warranty_period,
      capacity_value,
      capacity_unit,
      speed_value,
      speed_unit,
      interface_type,
      form_factor,
      is_active
    } = req.body;

    const pool = await connectDB();
    
    // Check if product exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, name, model, oem_id FROM products WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Product not found');
    }

    const existingProduct = existingResult.recordset[0];

    // Check for name/model conflict if being updated
    if ((name && name.trim() !== existingProduct.name) || 
        (model && model !== existingProduct.model) ||
        (oem_id && oem_id !== existingProduct.oem_id)) {
      
      const conflictCheckRequest = pool.request()
        .input('id', sql.UniqueIdentifier, id);

      const checkName = name ? name.trim() : existingProduct.name;
      const checkModel = model || existingProduct.model;
      const checkOemId = oem_id || existingProduct.oem_id;

      conflictCheckRequest
        .input('name', sql.VarChar(200), checkName)
        .input('model', sql.VarChar(100), checkModel)
        .input('oemId', sql.UniqueIdentifier, checkOemId);

      const conflictResult = await conflictCheckRequest.query(`
        SELECT id FROM products 
        WHERE LOWER(name) = LOWER(@name) 
        AND LOWER(model) = LOWER(@model) 
        AND oem_id = @oemId
        AND id != @id
      `);

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Product with this name and model already exists for this OEM');
      }
    }

    // Verify that referenced entities exist (if being updated)
    if (category_id || subcategory_id || oem_id || series_id) {
      const referencesRequest = pool.request();
      
      if (category_id) referencesRequest.input('categoryId', sql.UniqueIdentifier, category_id);
      if (subcategory_id) referencesRequest.input('subcategoryId', sql.UniqueIdentifier, subcategory_id);
      if (oem_id) referencesRequest.input('oemId', sql.UniqueIdentifier, oem_id);
      if (series_id) referencesRequest.input('seriesId', sql.UniqueIdentifier, series_id);

      let referencesQuery = 'SELECT ';
      const checks = [];
      
      if (category_id) checks.push('(SELECT COUNT(*) FROM categories WHERE id = @categoryId) as category_exists');
      if (subcategory_id) checks.push('(SELECT COUNT(*) FROM categories WHERE id = @subcategoryId) as subcategory_exists');
      if (oem_id) checks.push('(SELECT COUNT(*) FROM oems WHERE id = @oemId) as oem_exists');
      if (series_id) checks.push('(SELECT COUNT(*) FROM product_series WHERE id = @seriesId) as series_exists');
      
      referencesQuery += checks.join(', ');

      const referencesResult = await referencesRequest.query(referencesQuery);
      const refs = referencesResult.recordset[0];

      if (category_id && refs.category_exists === 0) {
        return sendNotFound(res, 'Category not found or inactive');
      }

      if (subcategory_id && refs.subcategory_exists === 0) {
        return sendNotFound(res, 'Subcategory not found or inactive');
      }

      if (oem_id && refs.oem_exists === 0) {
        return sendNotFound(res, 'OEM not found or inactive');
      }

      if (series_id && refs.series_exists === 0) {
        return sendNotFound(res, 'Series not found or inactive');
      }
    }

    // If subcategory is being updated, verify it belongs to the category
    if (subcategory_id && category_id) {
      const subcatResult = await pool.request()
        .input('subcategoryId', sql.UniqueIdentifier, subcategory_id)
        .input('categoryId', sql.UniqueIdentifier, category_id)
        .query(`
          SELECT id FROM categories 
          WHERE id = @subcategoryId AND parent_category_id = @categoryId
        `);

      if (subcatResult.recordset.length === 0) {
        return sendError(res, 'Subcategory does not belong to the specified category', 400);
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updateFields.push('name = @name');
      updateRequest.input('name', sql.VarChar(200), name.trim());
    }
    if (description !== undefined) {
      updateFields.push('description = @description');
      updateRequest.input('description', sql.VarChar(1000), description);
    }
    if (model !== undefined) {
      updateFields.push('model = @model');
      updateRequest.input('model', sql.VarChar(100), model);
    }
    if (type_id !== undefined) {
      updateFields.push('type_id = @typeId');
      updateRequest.input('typeId', sql.UniqueIdentifier, type_id);
    }
    if (category_id !== undefined) {
      updateFields.push('category_id = @categoryId');
      updateRequest.input('categoryId', sql.UniqueIdentifier, category_id);
    }
    if (subcategory_id !== undefined) {
      updateFields.push('subcategory_id = @subcategoryId');
      updateRequest.input('subcategoryId', sql.UniqueIdentifier, subcategory_id);
    }
    if (oem_id !== undefined) {
      updateFields.push('oem_id = @oemId');
      updateRequest.input('oemId', sql.UniqueIdentifier, oem_id);
    }
    if (series_id !== undefined) {
      updateFields.push('series_id = @seriesId');
      updateRequest.input('seriesId', sql.UniqueIdentifier, series_id);
    }
    if (specifications !== undefined) {
      updateFields.push('specifications = @specifications');
      updateRequest.input('specifications', sql.NVarChar(sql.MAX), specifications || null);
    }
    if (warranty_period !== undefined) {
      updateFields.push('warranty_period = @warrantyPeriod');
      updateRequest.input('warrantyPeriod', sql.Int, warranty_period);
    }
    if (capacity_value !== undefined) {
      updateFields.push('capacity_value = @capacityValue');
      updateRequest.input('capacityValue', sql.Decimal(10, 2), capacity_value);
    }
    if (capacity_unit !== undefined) {
      updateFields.push('capacity_unit = @capacityUnit');
      updateRequest.input('capacityUnit', sql.VarChar(20), capacity_unit);
    }
    if (speed_value !== undefined) {
      updateFields.push('speed_value = @speedValue');
      updateRequest.input('speedValue', sql.Decimal(10, 2), speed_value);
    }
    if (speed_unit !== undefined) {
      updateFields.push('speed_unit = @speedUnit');
      updateRequest.input('speedUnit', sql.VarChar(20), speed_unit);
    }
    if (interface_type !== undefined) {
      updateFields.push('interface_type = @interfaceType');
      updateRequest.input('interfaceType', sql.VarChar(50), interface_type);
    }
    if (form_factor !== undefined) {
      updateFields.push('form_factor = @formFactor');
      updateRequest.input('formFactor', sql.VarChar(50), form_factor);
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
      UPDATE products
      SET ${updateFields.join(', ')}
      WHERE id = @id;

      SELECT p.id, p.name, p.description, p.model, p.type_id, p.category_id, p.subcategory_id,
             p.oem_id, p.series_id, p.specifications, p.warranty_period,
             p.capacity_value, p.capacity_unit, p.speed_value, p.speed_unit,
             p.interface_type, p.form_factor, p.is_active,
             p.created_at, p.updated_at,
             pt.name as type_name,
             pc.name as category_name,
             psc.name as subcategory_name,
             ps.name as series_name,
             o.name as oem_name
      FROM products p
      LEFT JOIN product_types pt ON p.type_id = pt.id
      LEFT JOIN categories pc ON p.category_id = pc.id
      LEFT JOIN categories psc ON p.subcategory_id = psc.id
      LEFT JOIN product_series ps ON p.series_id = ps.id
      LEFT JOIN oems o ON p.oem_id = o.id
      WHERE p.id = @id;
    `);

    const product = result.recordset[0];

    sendSuccess(res, product, 'Product updated successfully');
  })
);

// DELETE /masters/products/:id - Delete product
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    
    // Check if product exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM products WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Product not found');
    }

    // Check if product is referenced by any assets
    const referencesResult = await pool.request()
      .input('productId', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM assets WHERE product_id = @productId AND is_active = 1');

    if (referencesResult.recordset[0].count > 0) {
      return sendConflict(res, 'Cannot delete product. It is referenced by existing assets.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE products 
        SET is_active = 0, updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Product deleted successfully');
  })
);

// POST /masters/products/bulk-upload - Bulk upload products from CSV/Excel
router.post('/bulk-upload',
  requireDynamicPermission(),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    try {
      let products = [];

      // Parse Excel file
      if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        products = XLSX.utils.sheet_to_json(worksheet);
      }
      // Parse CSV file
      else if (fileExtension === '.csv') {
        products = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
        });
      } else {
        return sendError(res, 'Unsupported file format', 400);
      }

      // Validate and process products
      const pool = await connectDB();
      const results = {
        total: products.length,
        success: 0,
        failed: 0,
        errors: []
      };

      // Get lookup data for foreign keys
      const [categories, oems, series, types] = await Promise.all([
        pool.request().query('SELECT id, name FROM categories WHERE is_active = 1'),
        pool.request().query('SELECT id, name, code FROM oems WHERE is_active = 1'),
        pool.request().query('SELECT id, name FROM product_series WHERE is_active = 1'),
        pool.request().query('SELECT id, name FROM product_types WHERE is_active = 1')
      ]);

      // Helper function for fuzzy matching
      const findMatch = (input, items, keyField = 'name') => {
        if (!input) return null;
        const inputLower = input.trim().toLowerCase();

        // Try exact match first
        let match = items.find(item => item[keyField].toLowerCase() === inputLower);
        if (match) return match;

        // Try code match (for OEMs and categories)
        if (items[0]?.code) {
          match = items.find(item => item.code?.toLowerCase() === inputLower);
          if (match) return match;
        }

        // Try partial match (contains)
        match = items.find(item => item[keyField].toLowerCase().includes(inputLower));
        if (match) return match;

        // Try reverse partial match (input contains item name)
        match = items.find(item => inputLower.includes(item[keyField].toLowerCase()));
        if (match) return match;

        return null;
      };

      // Helper function to auto-create OEM if not found
      const getOrCreateOEM = async (oemName) => {
        if (!oemName) return null;

        // Try to find existing OEM
        let oemMatch = findMatch(oemName, oems.recordset);
        if (oemMatch) return oemMatch.id;

        // Create new OEM
        const newOemId = uuidv4();
        const oemCode = oemName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);

        await pool.request()
          .input('id', sql.UniqueIdentifier, newOemId)
          .input('name', sql.VarChar(100), oemName.trim())
          .input('code', sql.VarChar(20), oemCode)
          .query(`
            INSERT INTO oems (id, name, code, is_active, created_at, updated_at)
            VALUES (@id, @name, @code, 1, GETUTCDATE(), GETUTCDATE())
          `);

        // Add to cache
        oems.recordset.push({ id: newOemId, name: oemName.trim(), code: oemCode });

        return newOemId;
      };

      // Helper function to auto-create Category if not found
      const getOrCreateCategory = async (categoryName, parentCategoryId = null) => {
        if (!categoryName) return null;

        // Try to find existing category
        let categoryMatch = findMatch(categoryName, categories.recordset);
        if (categoryMatch) return categoryMatch.id;

        // Create new category
        const newCategoryId = uuidv4();

        await pool.request()
          .input('id', sql.UniqueIdentifier, newCategoryId)
          .input('name', sql.VarChar(100), categoryName.trim())
          .input('parentCategoryId', sql.UniqueIdentifier, parentCategoryId)
          .query(`
            INSERT INTO categories (id, name, parent_category_id, is_active, created_at, updated_at)
            VALUES (@id, @name, @parentCategoryId, 1, GETUTCDATE(), GETUTCDATE())
          `);

        // Add to cache
        categories.recordset.push({ id: newCategoryId, name: categoryName.trim() });

        return newCategoryId;
      };

      // Helper function to auto-create Product Type if not found
      const getOrCreateProductType = async (typeName) => {
        if (!typeName) return null;

        // Try to find existing type
        let typeMatch = findMatch(typeName, types.recordset);
        if (typeMatch) return typeMatch.id;

        // Create new product type
        const newTypeId = uuidv4();

        await pool.request()
          .input('id', sql.UniqueIdentifier, newTypeId)
          .input('name', sql.VarChar(100), typeName.trim())
          .query(`
            INSERT INTO product_types (id, name, is_active, created_at, updated_at)
            VALUES (@id, @name, 1, GETUTCDATE(), GETUTCDATE())
          `);

        // Add to cache
        types.recordset.push({ id: newTypeId, name: typeName.trim() });

        return newTypeId;
      };

      // Helper function to auto-create Series if not found
      const getOrCreateSeries = async (seriesName, oemId, categoryId, subcategoryId) => {
        if (!seriesName) return null;

        // Try to find existing series
        let seriesMatch = findMatch(seriesName, series.recordset);
        if (seriesMatch) return seriesMatch.id;

        // Create new series
        const newSeriesId = uuidv4();

        await pool.request()
          .input('id', sql.UniqueIdentifier, newSeriesId)
          .input('name', sql.VarChar(255), seriesName.trim())
          .input('oemId', sql.UniqueIdentifier, oemId)
          .input('categoryId', sql.UniqueIdentifier, categoryId)
          .input('subCategoryId', sql.UniqueIdentifier, subcategoryId)
          .query(`
            INSERT INTO product_series (id, name, oem_id, category_id, sub_category_id, is_active, created_at, updated_at)
            VALUES (@id, @name, @oemId, @categoryId, @subCategoryId, 1, GETUTCDATE(), GETUTCDATE())
          `);

        // Add to cache
        series.recordset.push({ id: newSeriesId, name: seriesName.trim() });

        return newSeriesId;
      };

      // Process each product
      for (let i = 0; i < products.length; i++) {
        const row = products[i];
        const rowNumber = i + 2; // +2 because row 1 is header and array is 0-indexed

        try {
          // Validate required fields
          if (!row.name || !row.category || !row.oem) {
            results.errors.push({
              row: rowNumber,
              data: row,
              error: 'Missing required fields: name, category, and oem are required'
            });
            results.failed++;
            continue;
          }

          // Auto-create OEM if not found (or match existing)
          const oemId = await getOrCreateOEM(row.oem);
          if (!oemId) {
            results.errors.push({
              row: rowNumber,
              data: row,
              error: `Failed to create or find OEM "${row.oem}"`
            });
            results.failed++;
            continue;
          }

          // Auto-create Category if not found (or match existing)
          const categoryId = await getOrCreateCategory(row.category);
          if (!categoryId) {
            results.errors.push({
              row: rowNumber,
              data: row,
              error: `Failed to create or find Category "${row.category}"`
            });
            results.failed++;
            continue;
          }

          // Auto-create Subcategory if provided (or match existing)
          let subcategoryId = null;
          if (row.subcategory) {
            subcategoryId = await getOrCreateCategory(row.subcategory, categoryId);
          }

          // Auto-create Product Type if provided (or match existing)
          let typeId = null;
          if (row.type) {
            typeId = await getOrCreateProductType(row.type);
          }

          // Auto-create Series if provided (or match existing)
          let seriesId = null;
          if (row.series) {
            seriesId = await getOrCreateSeries(row.series, oemId, categoryId, subcategoryId);
          }

          // Check for duplicates (same name and model under same category)
          const duplicateCheck = await pool.request()
            .input('name', sql.VarChar(200), row.name)
            .input('model', sql.VarChar(100), row.model || null)
            .input('categoryId', sql.UniqueIdentifier, categoryId)
            .query(`
              SELECT id FROM products
              WHERE LOWER(name) = LOWER(@name)
                AND (model IS NULL AND @model IS NULL OR LOWER(model) = LOWER(@model))
                AND category_id = @categoryId
                AND is_active = 1
            `);

          if (duplicateCheck.recordset.length > 0) {
            results.errors.push({
              row: rowNumber,
              data: row,
              error: `Duplicate product: "${row.name}" with model "${row.model || 'N/A'}" already exists in category "${row.category}"`
            });
            results.failed++;
            continue;
          }

          // Insert product
          const productId = uuidv4();
          await pool.request()
            .input('id', sql.UniqueIdentifier, productId)
            .input('name', sql.VarChar(200), row.name)
            .input('model', sql.VarChar(100), row.model || null)
            .input('description', sql.VarChar(1000), row.description || null)
            .input('typeId', sql.UniqueIdentifier, typeId)
            .input('categoryId', sql.UniqueIdentifier, categoryId)
            .input('subcategoryId', sql.UniqueIdentifier, subcategoryId)
            .input('seriesId', sql.UniqueIdentifier, seriesId)
            .input('oemId', sql.UniqueIdentifier, oemId)
            .input('specifications', sql.NVarChar(sql.MAX), row.specifications || null)
            .input('warrantyPeriod', sql.Int, row.warranty_period ? parseInt(row.warranty_period) : null)
            .input('capacityValue', sql.Decimal(10, 2), row.capacity_value ? parseFloat(row.capacity_value) : null)
            .input('capacityUnit', sql.VarChar(20), row.capacity_unit || null)
            .input('speedValue', sql.Decimal(10, 2), row.speed_value ? parseFloat(row.speed_value) : null)
            .input('speedUnit', sql.VarChar(20), row.speed_unit || null)
            .input('interfaceType', sql.VarChar(50), row.interface_type || null)
            .input('formFactor', sql.VarChar(50), row.form_factor || null)
            .query(`
              INSERT INTO products (
                id, name, model, description, type_id, category_id, subcategory_id,
                series_id, oem_id, specifications, warranty_period,
                capacity_value, capacity_unit, speed_value, speed_unit,
                interface_type, form_factor, is_active, created_at, updated_at
              )
              VALUES (
                @id, @name, @model, @description, @typeId, @categoryId, @subcategoryId,
                @seriesId, @oemId, @specifications, @warrantyPeriod,
                @capacityValue, @capacityUnit, @speedValue, @speedUnit,
                @interfaceType, @formFactor, 1, GETUTCDATE(), GETUTCDATE()
              )
            `);

          results.success++;
        } catch (error) {
          results.errors.push({
            row: rowNumber,
            data: row,
            error: error.message
          });
          results.failed++;
        }
      }

      // Clean up uploaded file
      fs.unlinkSync(filePath);

      // Return results
      if (results.failed === 0) {
        sendSuccess(res, results, `Successfully uploaded ${results.success} products`);
      } else if (results.success === 0) {
        sendError(res, 'All products failed to upload', 400, results);
      } else {
        sendSuccess(res, results, `Uploaded ${results.success} products with ${results.failed} failures`);
      }

    } catch (error) {
      // Clean up uploaded file on error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw error;
    }
  })
);

module.exports = router;