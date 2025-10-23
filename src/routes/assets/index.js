const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const multer = require('multer');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireDynamicPermission, requireRole } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const validators = require('../../utils/validators');
const { logAssetAssignmentChange } = require('../../controllers/assetMovementController');
const { generateAssetBulkTemplate, parseAssetBulkFile, generateLegacyAssetTemplate, parseLegacyAssetFile } = require('../../utils/excel-template');
const { generateUniqueTagNo, generateUniqueAssetTag } = require('../../utils/tag-generator');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Import component routes
const componentRoutes = require('./components');

// Apply authentication to all asset routes
router.use(authenticateToken);

// Mount component routes - MUST be before other /:id routes to avoid conflicts
router.use('/:id/components', componentRoutes);

// GET /assets - List all assets with pagination, search, and filtering
router.get('/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const {
      search,
      status,
      condition_status,
      location_id,
      assigned_to,
      product_id,
      category_id,
      product_type_id,
      oem_id,
      warranty_expiring,
      board_id
    } = req.query;

    const pool = await connectDB();

    // Build WHERE clause
    // Exclude standby assets from regular inventory (they have their own standby pool view)
    let whereClause = 'a.is_active = 1 AND (a.is_standby_asset = 0 OR a.is_standby_asset IS NULL)';
    const params = [];

    if (search) {
      whereClause += ' AND (a.asset_tag LIKE @search OR p.name LIKE @search OR p.model LIKE @search OR a.notes LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND a.status = @status';
      params.push({ name: 'status', type: sql.VarChar(20), value: status });
    }

    if (condition_status) {
      whereClause += ' AND a.condition_status = @conditionStatus';
      params.push({ name: 'conditionStatus', type: sql.VarChar(20), value: condition_status });
    }

    if (location_id) {
      whereClause += ' AND u.location_id = @locationId';
      params.push({ name: 'locationId', type: sql.UniqueIdentifier, value: location_id });
    }

    if (assigned_to) {
      whereClause += ' AND a.assigned_to = @assignedTo';
      params.push({ name: 'assignedTo', type: sql.UniqueIdentifier, value: assigned_to });
    }

    if (product_id) {
      whereClause += ' AND a.product_id = @productId';
      params.push({ name: 'productId', type: sql.UniqueIdentifier, value: product_id });
    }

    if (category_id) {
      whereClause += ' AND p.category_id = @categoryId';
      params.push({ name: 'categoryId', type: sql.UniqueIdentifier, value: category_id });
    }

    if (product_type_id) {
      whereClause += ' AND p.type_id = @productTypeId';
      params.push({ name: 'productTypeId', type: sql.UniqueIdentifier, value: product_type_id });
    }

    if (oem_id) {
      whereClause += ' AND p.oem_id = @oemId';
      params.push({ name: 'oemId', type: sql.UniqueIdentifier, value: oem_id });
    }

    // Warranty expiring filter (within 30 days)
    if (warranty_expiring === 'true') {
      whereClause += ' AND a.warranty_end_date IS NOT NULL AND a.warranty_end_date BETWEEN GETUTCDATE() AND DATEADD(day, 30, GETUTCDATE())';
    }

    // Board filter (via user's department)
    if (board_id) {
      whereClause += ' AND bd.board_id = @boardId';
      params.push({ name: 'boardId', type: sql.UniqueIdentifier, value: board_id });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_types pt ON p.type_id = pt.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN DEPARTMENT_MASTER dept ON u.department_id = dept.department_id
      LEFT JOIN BOARD_DEPARTMENTS bd ON dept.department_id = bd.department_id
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['asset_tag', 'status', 'condition_status', 'purchase_date', 'warranty_end_date', 'created_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? `a.${sortBy}` : 'a.created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT
        a.id, a.asset_tag, a.tag_no, a.serial_number, a.status, a.condition_status, a.purchase_date, a.warranty_end_date,
        a.purchase_cost, a.notes, a.created_at, a.updated_at,
        a.product_id, a.assigned_to,
        a.asset_type, a.parent_asset_id, a.installation_date, a.removal_date,
        p.name as product_name, p.model as product_model,
        c.id as category_id, c.name as category_name,
        pt.id as product_type_id, pt.name as product_type_name,
        o.id as oem_id, o.name as oem_name,
        u.location_id,
        u.first_name + ' ' + u.last_name as assigned_user_name,
        u.email as assigned_user_email,
        d.department_name as department,
        l.name as location_name,
        l.address as location_address,
        l.building as location_building,
        l.floor as location_floor,
        (SELECT COUNT(*) FROM assets comp WHERE comp.parent_asset_id = a.id AND comp.is_active = 1 AND comp.removal_date IS NULL) as installed_component_count,
        CASE
          WHEN a.warranty_end_date IS NULL THEN 'No Warranty'
          WHEN a.warranty_end_date < GETUTCDATE() THEN 'Expired'
          WHEN a.warranty_end_date BETWEEN GETUTCDATE() AND DATEADD(day, 30, GETUTCDATE()) THEN 'Expiring Soon'
          ELSE 'Active'
        END as warranty_status
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_types pt ON p.type_id = pt.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN BOARD_DEPARTMENTS bd ON d.department_id = bd.department_id
      WHERE ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      assets: result.recordset,
      pagination
    }, 'Assets retrieved successfully');
  })
);

// GET /assets/statistics - Get asset statistics for dashboard
router.get('/statistics',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        COUNT(*) as total_assets,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_assets,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned_assets,
        SUM(CASE WHEN status = 'in_use' THEN 1 ELSE 0 END) as in_use_assets,
        SUM(CASE WHEN status = 'under_repair' THEN 1 ELSE 0 END) as under_repair_assets,
        SUM(CASE WHEN warranty_end_date IS NOT NULL AND warranty_end_date BETWEEN GETUTCDATE() AND DATEADD(day, 30, GETUTCDATE()) THEN 1 ELSE 0 END) as warranty_expiring_soon,
        SUM(CASE WHEN warranty_end_date IS NOT NULL AND warranty_end_date < GETUTCDATE() THEN 1 ELSE 0 END) as warranty_expired,
        SUM(CASE WHEN created_at >= DATEADD(month, -1, GETUTCDATE()) THEN 1 ELSE 0 END) as added_this_month,
        AVG(CASE WHEN purchase_cost IS NOT NULL THEN purchase_cost ELSE 0 END) as average_cost,
        SUM(CASE WHEN purchase_cost IS NOT NULL THEN purchase_cost ELSE 0 END) as total_value
      FROM assets
      WHERE is_active = 1
    `);

    // Get location distribution (assets inherit location from assigned users)
    const locationResult = await pool.request().query(`
      SELECT
        l.id, l.name as location_name, l.building, l.floor,
        COUNT(a.id) as asset_count
      FROM locations l
      LEFT JOIN USER_MASTER u ON l.id = u.location_id AND u.is_active = 1
      LEFT JOIN assets a ON u.user_id = a.assigned_to AND a.is_active = 1
      WHERE l.is_active = 1
      GROUP BY l.id, l.name, l.building, l.floor
      ORDER BY asset_count DESC
    `);

    // Get category distribution
    const categoryResult = await pool.request().query(`
      SELECT
        c.id, c.name as category_name,
        COUNT(a.id) as asset_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id
      LEFT JOIN assets a ON p.id = a.product_id AND a.is_active = 1
      WHERE c.is_active = 1
      GROUP BY c.id, c.name
      ORDER BY asset_count DESC
    `);

    const overview = result.recordset[0];

    sendSuccess(res, {
      // Main statistics
      totalAssets: overview.total_assets,
      activeAssets: overview.available_assets + overview.assigned_assets + overview.in_use_assets,
      assetsAtRisk: overview.under_repair_assets + overview.warranty_expiring_soon + overview.warranty_expired,
      addedThisMonth: overview.added_this_month,

      // Additional overview data
      availableAssets: overview.available_assets,
      assignedAssets: overview.assigned_assets,
      inUseAssets: overview.in_use_assets,
      underRepairAssets: overview.under_repair_assets,
      warrantyExpiringSoon: overview.warranty_expiring_soon,
      warrantyExpired: overview.warranty_expired,
      averageCost: overview.average_cost,
      totalValue: overview.total_value,

      // Distributions
      locationDistribution: locationResult.recordset,
      categoryDistribution: categoryResult.recordset,

      // Status distribution for charts
      statusDistribution: [
        { status: 'available', count: overview.available_assets },
        { status: 'assigned', count: overview.assigned_assets },
        { status: 'in_use', count: overview.in_use_assets },
        { status: 'under_repair', count: overview.under_repair_assets }
      ].filter(item => item.count > 0),

      // Critical alerts
      criticalAlerts: [
        ...(overview.warranty_expiring_soon > 0 ? [{
          type: 'warranty_expiring',
          message: `${overview.warranty_expiring_soon} assets have warranty expiring within 30 days`,
          count: overview.warranty_expiring_soon,
          severity: 'warning'
        }] : []),
        ...(overview.warranty_expired > 0 ? [{
          type: 'warranty_expired',
          message: `${overview.warranty_expired} assets have expired warranty`,
          count: overview.warranty_expired,
          severity: 'error'
        }] : []),
        ...(overview.under_repair_assets > 0 ? [{
          type: 'under_repair',
          message: `${overview.under_repair_assets} assets are currently under repair`,
          count: overview.under_repair_assets,
          severity: 'warning'
        }] : [])
      ]
    }, 'Asset statistics retrieved successfully');
  })
);

// GET /assets/export - Export assets to Excel
router.get('/export',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const {
      format = 'xlsx',
      search,
      status,
      condition_status,
      location_id,
      assigned_to,
      product_id,
      category_id,
      product_type_id,
      oem_id,
      warranty_expiring
    } = req.query;

    const pool = await connectDB();

    // Build WHERE clause for export (same as list query)
    let whereClause = 'a.is_active = 1';
    const params = [];

    if (search) {
      whereClause += ' AND (a.asset_tag LIKE @search OR p.name LIKE @search OR p.model LIKE @search OR o.name LIKE @search OR a.notes LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND a.status = @status';
      params.push({ name: 'status', type: sql.VarChar(20), value: status });
    }

    if (condition_status) {
      whereClause += ' AND a.condition_status = @conditionStatus';
      params.push({ name: 'conditionStatus', type: sql.VarChar(20), value: condition_status });
    }

    if (location_id) {
      whereClause += ' AND u.location_id = @locationId';
      params.push({ name: 'locationId', type: sql.UniqueIdentifier, value: location_id });
    }

    if (assigned_to) {
      whereClause += ' AND a.assigned_to = @assignedTo';
      params.push({ name: 'assignedTo', type: sql.UniqueIdentifier, value: assigned_to });
    }

    if (product_id) {
      whereClause += ' AND a.product_id = @productId';
      params.push({ name: 'productId', type: sql.UniqueIdentifier, value: product_id });
    }

    if (category_id) {
      whereClause += ' AND p.category_id = @categoryId';
      params.push({ name: 'categoryId', type: sql.UniqueIdentifier, value: category_id });
    }

    if (product_type_id) {
      whereClause += ' AND p.type_id = @productTypeId';
      params.push({ name: 'productTypeId', type: sql.UniqueIdentifier, value: product_type_id });
    }

    if (oem_id) {
      whereClause += ' AND p.oem_id = @oemId';
      params.push({ name: 'oemId', type: sql.UniqueIdentifier, value: oem_id });
    }

    if (warranty_expiring === 'true') {
      whereClause += ' AND a.warranty_end_date IS NOT NULL AND a.warranty_end_date <= DATEADD(day, 30, GETUTCDATE())';
    } else if (warranty_expiring === 'false') {
      whereClause += ' AND (a.warranty_end_date IS NULL OR a.warranty_end_date > DATEADD(day, 30, GETUTCDATE()))';
    }

    // Get all assets for export (no pagination)
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        a.id, a.asset_tag, a.tag_no, a.serial_number, a.status, a.condition_status,
        a.purchase_date, a.warranty_end_date, a.purchase_cost, a.notes, a.created_at, a.updated_at,
        a.asset_type, a.parent_asset_id, a.installation_date, a.removal_date, a.installation_notes,
        p.name as product_name, p.model as product_model,
        l.name as location_name, l.building as location_building, l.floor as location_floor, l.address as location_address,
        u.first_name + ' ' + u.last_name as assigned_user_name, u.email as assigned_user_email,
        d.department_name as department_name,
        c.name as category_name,
        o.name as oem_name,
        parent.asset_tag as parent_asset_tag,
        (SELECT COUNT(*) FROM assets comp WHERE comp.parent_asset_id = a.id AND comp.is_active = 1 AND comp.removal_date IS NULL) as component_count
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      LEFT JOIN assets parent ON a.parent_asset_id = parent.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
    `);

    const assets = result.recordset;

    if (format === 'xlsx') {
      const XLSX = require('xlsx');

      // Transform data for Excel export
      const excelData = assets.map(asset => ({
        'Asset Tag': asset.asset_tag,
        'Tag No': asset.tag_no || '',
        'Serial Number': asset.serial_number || '',
        'Product Name': asset.product_name,
        'Product Model': asset.product_model || '',
        'OEM': asset.oem_name || '',
        'Category': asset.category_name || '',
        'Asset Type': asset.asset_type || 'standalone',
        'Parent Asset Tag': asset.parent_asset_tag || '',
        'Component Count': asset.component_count || 0,
        'Installation Date': asset.installation_date ? new Date(asset.installation_date).toLocaleDateString() : '',
        'Removal Date': asset.removal_date ? new Date(asset.removal_date).toLocaleDateString() : '',
        'Installation Notes': asset.installation_notes || '',
        'Department': asset.department_name || '',
        'Location': asset.location_name || '',
        'Building': asset.location_building || '',
        'Floor': asset.location_floor || '',
        'Room No./Address': asset.location_address || '',
        'Assigned User': asset.assigned_user_name || '',
        'User Email': asset.assigned_user_email || '',
        'Status': asset.status,
        'Condition': asset.condition_status,
        'Purchase Date': asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString() : '',
        'Warranty End Date': asset.warranty_end_date ? new Date(asset.warranty_end_date).toLocaleDateString() : '',
        'Purchase Cost': asset.purchase_cost || '',
        'Notes': asset.notes || '',
        'Created At': new Date(asset.created_at).toLocaleDateString(),
        'Updated At': new Date(asset.updated_at).toLocaleDateString()
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Assets');

      const fileName = `assets_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.send(buffer);
    } else {
      // Return JSON format for other cases
      sendSuccess(res, {
        assets,
        count: assets.length,
        exportedAt: new Date().toISOString()
      }, 'Assets exported successfully');
    }
  })
);

// GET /assets/deleted - Get soft deleted assets
router.get('/deleted',
  authenticateToken,
  asyncHandler(async (req, res) => {
    console.log('Deleted assets route hit');
    console.log('User:', req.user);
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'updated_at',
      order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;
    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = 'a.is_active = 0';
    const params = [];

    if (search) {
      whereClause += ' AND (a.asset_tag LIKE @search OR p.name LIKE @search OR p.model LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    // Get total count for pagination
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, parseInt(limit));

    const result = await dataRequest.query(`
      SELECT
        a.id, a.asset_tag, a.status, a.condition_status, a.purchase_date, a.warranty_end_date,
        a.purchase_cost, a.notes, a.created_at, a.updated_at,
        a.product_id, p.name as product_name, p.model as product_model, p.description as product_description,
        p.specifications, p.warranty_period,
        u.location_id, l.name as location_name, l.address as location_address,
        a.assigned_to, u.first_name + ' ' + u.last_name as assigned_user_name,
        u.email as assigned_user_email, u.employee_id,
        c.id as category_id, c.name as category_name,
        sc.id as subcategory_id, sc.name as subcategory_name,
        o.id as oem_id, o.name as oem_name, o.contact_person as oem_contact
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories sc ON p.subcategory_id = sc.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE ${whereClause}
      ORDER BY a.${sort_by} ${order.toUpperCase()}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const assets = result.recordset.map(asset => {
      let specifications = null;
      try {
        specifications = asset.specifications ? JSON.parse(asset.specifications) : null;
      } catch (e) {
        console.warn(`Failed to parse specifications for asset ${asset.id}:`, e.message);
        specifications = asset.specifications; // Keep as string if parsing fails
      }

      return {
        ...asset,
        // Parse specifications JSON if available
        specifications,
        // Calculate warranty status
        warranty_status: asset.warranty_end_date ? (
          new Date(asset.warranty_end_date) < new Date() ? 'Expired' :
          new Date(asset.warranty_end_date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? 'Expiring Soon' : 'Active'
        ) : 'No Warranty',
        warranty_days_remaining: asset.warranty_end_date ?
          Math.ceil((new Date(asset.warranty_end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null
      };
    });

    sendSuccess(res, {
      assets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Deleted assets retrieved successfully');
  })
);

// GET /assets/bulk-template - Generate Excel template for bulk asset upload
router.get('/bulk-template',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { quantity, product_id } = req.query;

    if (!quantity || !product_id) {
      return sendError(res, 'quantity and product_id are required', 400);
    }

    const pool = await connectDB();

    // Fetch product details with category and OEM
    const productResult = await pool.request()
      .input('productId', sql.UniqueIdentifier, product_id)
      .query(`
        SELECT
          p.id, p.name, p.model,
          c.name as category_name,
          o.name as oem_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN oems o ON p.oem_id = o.id
        WHERE p.id = @productId
      `);

    if (productResult.recordset.length === 0) {
      return sendNotFound(res, 'Product not found');
    }

    const product = productResult.recordset[0];

    // Generate template
    const buffer = await generateAssetBulkTemplate({
      quantity: parseInt(quantity),
      product
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=bulk_assets_template_${quantity}_items.xlsx`);
    res.send(buffer);
  })
);

// POST /assets/parse-bulk-file - Parse uploaded Excel file and return validated data
router.post('/parse-bulk-file',
  requireDynamicPermission(),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const { product_id } = req.body;

    if (!product_id) {
      return sendError(res, 'product_id is required', 400);
    }

    try {
      const assets = await parseAssetBulkFile(req.file.buffer, product_id);

      // Check for existing serial numbers in database
      const pool = await connectDB();
      const serialNumbers = assets.map(a => a.serial_number);

      const request = pool.request();
      serialNumbers.forEach((serial, index) => {
        request.input(`serial${index}`, sql.VarChar(100), serial);
      });

      const existingSerials = await request.query(`
        SELECT serial_number
        FROM assets
        WHERE serial_number IN (${serialNumbers.map((_, i) => `@serial${i}`).join(',')})
      `);

      if (existingSerials.recordset.length > 0) {
        const existing = existingSerials.recordset.map(r => r.serial_number);
        return sendError(res, `Serial numbers already exist in database: ${existing.join(', ')}`, 400);
      }

      return sendSuccess(res, assets, 'File parsed successfully');
    } catch (error) {
      return sendError(res, error.message, 400);
    }
  })
);

// GET /assets/legacy-template - Generate Excel template for legacy asset upload
router.get('/legacy-template',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    // Fetch all products with category and OEM
    const productsResult = await pool.request().query(`
      SELECT
        p.id, p.name, p.model,
        c.name as category_name,
        o.name as oem_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN oems o ON p.oem_id = o.id
      WHERE p.is_active = 1
      ORDER BY p.name
    `);

    // Fetch all active users
    const usersResult = await pool.request().query(`
      SELECT
        user_id, first_name, last_name, email, employee_id,
        d.department_name
      FROM USER_MASTER u
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      WHERE u.is_active = 1
      ORDER BY u.first_name, u.last_name
    `);

    // Generate template
    const buffer = await generateLegacyAssetTemplate({
      products: productsResult.recordset,
      users: usersResult.recordset
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=legacy_asset_upload_template.xlsx');
    res.send(buffer);
  })
);

// POST /assets/legacy-validate - Validate legacy asset upload file
router.post('/legacy-validate',
  requireDynamicPermission(),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const pool = await connectDB();

    // Fetch reference data for validation
    const [productsResult, usersResult, serialNumbersResult] = await Promise.all([
      pool.request().query(`
        SELECT
          p.id, p.name, p.model,
          c.name as category_name,
          o.name as oem_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN oems o ON p.oem_id = o.id
        WHERE p.is_active = 1
      `),
      pool.request().query(`
        SELECT
          user_id, first_name, last_name, email, employee_id,
          d.department_name
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        WHERE u.is_active = 1
      `),
      pool.request().query('SELECT LOWER(serial_number) as serial_number FROM assets WHERE serial_number IS NOT NULL')
    ]);

    const existingSerialNumbers = serialNumbersResult.recordset.map(r => r.serial_number);

    try {
      const validationResult = await parseLegacyAssetFile(req.file.buffer, {
        products: productsResult.recordset,
        users: usersResult.recordset,
        existingSerialNumbers
      });

      return sendSuccess(res, validationResult, 'File validated successfully');
    } catch (error) {
      return sendError(res, error.message, 400);
    }
  })
);

// POST /assets/legacy-import - Execute legacy asset import
router.post('/legacy-import',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { assets } = req.body;

    if (!assets || !Array.isArray(assets) || assets.length === 0) {
      return sendError(res, 'No assets provided for import', 400);
    }

    const pool = await connectDB();
    const results = {
      successful: [],
      failed: []
    };

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);

      for (const asset of batch) {
        try {
          // Extract component hierarchy fields
          const asset_type = asset.asset_type || 'standalone';
          const parent_serial_number = asset.parent_serial_number; // CHANGED: from parent_asset_tag
          const installation_notes = asset.installation_notes;

          // Resolve parent_serial_number to parent_asset_id if provided
          let parentAssetId = null;
          if (parent_serial_number) {
            const parentResult = await pool.request()
              .input('serialNumber', sql.VarChar(100), parent_serial_number)
              .query('SELECT id, asset_type FROM assets WHERE serial_number = @serialNumber AND is_active = 1');

            if (parentResult.recordset.length === 0) {
              throw new Error(`Parent asset not found with serial number: ${parent_serial_number}`);
            }

            const parentAsset = parentResult.recordset[0];
            if (parentAsset.asset_type === 'component') {
              throw new Error('Cannot install component into another component');
            }

            parentAssetId = parentAsset.id;
          }

          const assetId = uuidv4();

          // Validate component installation if it's a component
          if (asset_type === 'component' && parentAssetId) {
            const validationResult = await pool.request()
              .input('component_id', sql.UniqueIdentifier, assetId)
              .input('parent_id', sql.UniqueIdentifier, parentAssetId)
              .output('is_valid', sql.Bit)
              .output('error_message', sql.VarChar(500))
              .execute('sp_validate_component_installation');

            if (!validationResult.output.is_valid) {
              throw new Error(validationResult.output.error_message);
            }
          }

          // Get product name for asset_tag generation
          const productResult = await pool.request()
            .input('productId', sql.UniqueIdentifier, asset.product_id)
            .query('SELECT name FROM products WHERE id = @productId');

          if (productResult.recordset.length === 0) {
            throw new Error('Product not found');
          }

          const productName = productResult.recordset[0].name;

          // Auto-generate asset_tag from product name
          const assetTag = await generateUniqueAssetTag(productName, asset.product_id);

          // Get location from assigned user if available
          let userLocationId = null;
          if (asset.assigned_to) {
            const userResult = await pool.request()
              .input('userId', sql.UniqueIdentifier, asset.assigned_to)
              .query('SELECT location_id FROM USER_MASTER WHERE user_id = @userId');
            if (userResult.recordset.length > 0) {
              userLocationId = userResult.recordset[0].location_id;
            }
          }

          // Generate unique tag_no
          const tagNo = await generateUniqueTagNo(assetTag, userLocationId);

          // Determine final status for components
          const finalStatus = asset_type === 'component' ? 'in_use' : asset.status;

          await pool.request()
            .input('id', sql.UniqueIdentifier, assetId)
            .input('assetTag', sql.VarChar(50), assetTag)
            .input('tagNo', sql.VarChar(100), tagNo)
            .input('serialNumber', sql.VarChar(100), asset.serial_number)
            .input('productId', sql.UniqueIdentifier, asset.product_id)
            .input('assignedTo', sql.UniqueIdentifier, asset.assigned_to)
            .input('status', sql.VarChar(20), finalStatus)
            .input('conditionStatus', sql.VarChar(20), asset.condition_status)
            .input('purchaseDate', sql.Date, asset.purchase_date)
            .input('purchaseCost', sql.Decimal(10, 2), asset.purchase_cost)
            .input('warrantyEndDate', sql.Date, asset.warranty_end_date)
            .input('notes', sql.NVarChar(sql.MAX), asset.notes)
            .input('assetType', sql.VarChar(20), asset_type)
            .input('parentAssetId', sql.UniqueIdentifier, parentAssetId)
            .input('installationDate', sql.DateTime, asset_type === 'component' ? new Date() : null)
            .input('installationNotes', sql.Text, installation_notes)
            .query(`
              INSERT INTO assets (
                id, asset_tag, tag_no, serial_number, product_id, assigned_to,
                status, condition_status, purchase_date, purchase_cost, warranty_end_date,
                notes, is_active,
                asset_type, parent_asset_id, installation_date, installation_notes,
                created_at, updated_at
              ) VALUES (
                @id, @assetTag, @tagNo, @serialNumber, @productId, @assignedTo,
                @status, @conditionStatus, @purchaseDate, @purchaseCost, @warrantyEndDate,
                @notes, 1,
                @assetType, @parentAssetId, @installationDate, @installationNotes,
                GETUTCDATE(), GETUTCDATE()
              )
            `);

          results.successful.push({
            row: asset.row_number,
            serial_number: asset.serial_number
          });
        } catch (error) {
          results.failed.push({
            row: asset.row_number,
            serial_number: asset.serial_number,
            error: error.message
          });
        }
      }
    }

    return sendSuccess(res, {
      total: assets.length,
      successful: results.successful.length,
      failed: results.failed.length,
      details: results
    }, 'Legacy import completed');
  })
);

// GET /assets/dropdown - Get assets for dropdown/selection
// IMPORTANT: This must be BEFORE /:id routes to avoid treating "dropdown" as a UUID
router.get('/dropdown',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const {
      status,
      category_id,
      location_id,
      available_only,
      asset_type,
      exclude_standby,        // NEW: Exclude standby pool assets
      exclude_components,     // NEW: Exclude already-installed components
      exclude_assigned        // NEW: Exclude assigned assets
    } = req.query;

    const pool = await connectDB();
    const request = pool.request();

    let query = `
      SELECT
        a.id,
        a.asset_tag as label,
        a.id as value,
        a.status,
        a.asset_type,
        a.serial_number,
        a.assigned_to,
        a.parent_asset_id,
        a.is_standby_asset,
        p.name as product_name,
        l.name as location_name
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE a.is_active = 1
    `;

    // Base filters
    if (available_only === 'true') {
      query += ' AND a.status = \'available\'';
      query += ' AND a.assigned_to IS NULL';  // Must not be assigned
    }

    if (status) {
      query += ' AND a.status = @status';
      request.input('status', sql.VarChar(20), status);
    }

    if (asset_type) {
      query += ' AND a.asset_type = @assetType';
      request.input('assetType', sql.VarChar(20), asset_type);
    }

    if (category_id) {
      query += ' AND p.category_id = @categoryId';
      request.input('categoryId', sql.UniqueIdentifier, category_id);
    }

    if (location_id) {
      query += ' AND u.location_id = @locationId';
      request.input('locationId', sql.UniqueIdentifier, location_id);
    }

    // NEW: Component Installation Specific Filters
    if (exclude_standby === 'true') {
      query += ' AND a.is_standby_asset = 0';  // Not in standby pool
    }

    if (exclude_components === 'true') {
      query += ' AND a.parent_asset_id IS NULL';  // Not already a component
    }

    if (exclude_assigned === 'true') {
      query += ' AND a.assigned_to IS NULL';  // Not assigned to user
    }

    // Exclude assets with active standby assignments (they're loaned out)
    query += `
      AND NOT EXISTS (
        SELECT 1 FROM STANDBY_ASSIGNMENTS sa
        WHERE sa.standby_asset_id = a.id AND sa.status = 'active'
      )
    `;

    query += ' ORDER BY a.asset_tag';

    const result = await request.query(query);

    sendSuccess(res, result.recordset, 'Assets dropdown retrieved successfully');
  })
);

// GET /assets/:id - Get asset by ID
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
          a.id, a.asset_tag, a.status, a.condition_status, a.purchase_date, a.warranty_end_date,
          a.purchase_cost, a.notes, a.created_at, a.updated_at,
          a.product_id, p.name as product_name, p.model as product_model, p.description as product_description,
          p.specifications, p.warranty_period,
          u.location_id, l.name as location_name, l.address as location_address,
          a.assigned_to, u.first_name + ' ' + u.last_name as assigned_user_name,
          u.email as assigned_user_email, u.employee_id,
          c.id as category_id, c.name as category_name,
          sc.id as subcategory_id, sc.name as subcategory_name,
          o.id as oem_id, o.name as oem_name, o.contact_person as oem_contact,
          CASE
            WHEN a.warranty_end_date IS NULL THEN 'No Warranty'
            WHEN a.warranty_end_date < GETUTCDATE() THEN 'Expired'
            WHEN a.warranty_end_date BETWEEN GETUTCDATE() AND DATEADD(day, 30, GETUTCDATE()) THEN 'Expiring Soon'
            ELSE 'Active'
          END as warranty_status,
          DATEDIFF(day, GETUTCDATE(), a.warranty_end_date) as warranty_days_remaining
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories sc ON p.subcategory_id = sc.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE a.id = @id AND a.is_active = 1
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const asset = result.recordset[0];

    // Parse specifications JSON if available
    if (asset.specifications) {
      try {
        asset.specifications = JSON.parse(asset.specifications);
      } catch (e) {
        asset.specifications = null;
      }
    }

    sendSuccess(res, asset, 'Asset retrieved successfully');
  })
);

// POST /assets/bulk - Bulk create assets
router.post('/bulk',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { assets } = req.body;

    if (!Array.isArray(assets) || assets.length === 0) {
      return sendError(res, 'Assets array is required and must not be empty', 400);
    }

    const pool = await connectDB();
    const createdAssets = [];
    const errors = [];

    // Check for duplicate serial numbers in request
    const serialNumbers = assets.map(a => a.serial_number).filter(Boolean);
    const duplicatesInRequest = serialNumbers.filter((item, index) => serialNumbers.indexOf(item) !== index);

    if (duplicatesInRequest.length > 0) {
      return sendError(res, `Duplicate serial numbers in request: ${duplicatesInRequest.join(', ')}`, 400);
    }

    // Check for existing serial numbers in database
    if (serialNumbers.length > 0) {
      const existingCheck = await pool.request()
        .query(`
          SELECT serial_number
          FROM assets
          WHERE serial_number IN (${serialNumbers.map((_, i) => `@serial${i}`).join(',')})
        `);

      const request = pool.request();
      serialNumbers.forEach((sn, i) => request.input(`serial${i}`, sql.VarChar(100), sn));
      const existingResult = await request.query(`
        SELECT serial_number
        FROM assets
        WHERE serial_number IN (${serialNumbers.map((_, i) => `@serial${i}`).join(',')})
      `);

      if (existingResult.recordset.length > 0) {
        const existing = existingResult.recordset.map(r => r.serial_number);
        return sendError(res, `Serial numbers already exist: ${existing.join(', ')}`, 409);
      }
    }

    // Create assets
    for (const asset of assets) {
      try {
        const {
          serial_number,
          product_id,
          status = 'available',
          condition_status = 'good',
          purchase_date,
          warranty_end_date,
          purchase_cost,
          notes,
          // Component hierarchy fields
          asset_type = 'standalone',
          parent_serial_number, // CHANGED: from parent_asset_tag to parent_serial_number
          installation_notes
        } = asset;

        if (!serial_number) {
          errors.push({ asset, error: 'Serial number is required' });
          continue;
        }

        if (!product_id) {
          errors.push({ asset, error: 'Product ID is required' });
          continue;
        }

        // Validate component requirements
        // Note: Components can exist without a parent (spare/stock components)
        // Parent is only required if the component status indicates it's installed

        if (asset_type === 'component' && asset.assigned_to) {
          errors.push({ asset, error: 'Components cannot be assigned to users' });
          continue;
        }

        // Resolve parent_serial_number to parent_asset_id if provided
        let parentAssetId = null;
        if (parent_serial_number) {
          const parentResult = await pool.request()
            .input('serialNumber', sql.VarChar(100), parent_serial_number)
            .query('SELECT id, asset_type FROM assets WHERE serial_number = @serialNumber AND is_active = 1');

          if (parentResult.recordset.length === 0) {
            errors.push({ asset, error: `Parent asset not found with serial number: ${parent_serial_number}` });
            continue;
          }

          const parentAsset = parentResult.recordset[0];
          if (parentAsset.asset_type === 'component') {
            errors.push({ asset, error: 'Cannot install component into another component' });
            continue;
          }

          parentAssetId = parentAsset.id;
        }

        // Get product name for asset_tag generation
        const productResult = await pool.request()
          .input('productId', sql.UniqueIdentifier, product_id)
          .query('SELECT name FROM products WHERE id = @productId');

        if (productResult.recordset.length === 0) {
          errors.push({ asset, error: 'Product not found' });
          continue;
        }

        const productName = productResult.recordset[0].name;

        // Auto-generate asset_tag from product name
        const assetTag = await generateUniqueAssetTag(productName, product_id);

        // Get location from assigned user if asset has assigned_to
        let userLocationId = null;
        if (asset.assigned_to) {
          const userResult = await pool.request()
            .input('userId', sql.UniqueIdentifier, asset.assigned_to)
            .query('SELECT location_id FROM USER_MASTER WHERE user_id = @userId');
          if (userResult.recordset.length > 0) {
            userLocationId = userResult.recordset[0].location_id;
          }
        }

        // Generate unique tag_no
        const tagNo = await generateUniqueTagNo(assetTag, userLocationId);

        // Generate asset ID upfront for validation
        const assetId = uuidv4();

        // Validate component installation if it's a component
        if (asset_type === 'component' && parentAssetId) {
          const validationResult = await pool.request()
            .input('component_id', sql.UniqueIdentifier, assetId)
            .input('parent_id', sql.UniqueIdentifier, parentAssetId)
            .output('is_valid', sql.Bit)
            .output('error_message', sql.VarChar(500))
            .execute('sp_validate_component_installation');

          if (!validationResult.output.is_valid) {
            errors.push({ asset, error: validationResult.output.error_message });
            continue;
          }
        }

        // Determine final status for components
        const finalStatus = asset_type === 'component' ? 'in_use' : status;

        const request = pool.request()
          .input('id', sql.UniqueIdentifier, assetId)
          .input('assetTag', sql.VarChar(50), assetTag)
          .input('tagNo', sql.VarChar(100), tagNo)
          .input('serialNumber', sql.VarChar(100), serial_number)
          .input('productId', sql.UniqueIdentifier, product_id)
          .input('assignedTo', sql.UniqueIdentifier, asset.assigned_to || null)
          .input('status', sql.VarChar(20), finalStatus)
          .input('conditionStatus', sql.VarChar(20), condition_status)
          .input('purchaseDate', sql.Date, purchase_date || null)
          .input('warrantyEndDate', sql.Date, warranty_end_date || null)
          .input('purchaseCost', sql.Decimal(10, 2), purchase_cost || null)
          .input('notes', sql.Text, notes || null)
          .input('isActive', sql.Bit, true)
          .input('assetType', sql.VarChar(20), asset_type)
          .input('parentAssetId', sql.UniqueIdentifier, parentAssetId)
          .input('installationDate', sql.DateTime, asset_type === 'component' ? new Date() : null)
          .input('installationNotes', sql.Text, installation_notes || null);

        const result = await request.query(`
          INSERT INTO assets (
            id, asset_tag, tag_no, serial_number, product_id, assigned_to, status, condition_status,
            purchase_date, warranty_end_date, purchase_cost, notes, is_active,
            asset_type, parent_asset_id, installation_date, installation_notes,
            created_at, updated_at
          )
          OUTPUT INSERTED.*
          VALUES (
            @id, @assetTag, @tagNo, @serialNumber, @productId, @assignedTo, @status, @conditionStatus,
            @purchaseDate, @warrantyEndDate, @purchaseCost, @notes, @isActive,
            @assetType, @parentAssetId, @installationDate, @installationNotes,
            GETUTCDATE(), GETUTCDATE()
          )
        `);

        createdAssets.push(result.recordset[0]);
      } catch (error) {
        console.error('Error creating asset:', error);
        errors.push({ asset, error: error.message });
      }
    }

    sendSuccess(res, {
      created: createdAssets.length,
      assets: createdAssets,
      errors: errors.length > 0 ? errors : undefined
    }, `Successfully created ${createdAssets.length} asset(s)`);
  })
);

// POST /assets - Create new asset
router.post('/',
  requireDynamicPermission(),
  validateBody(validators.asset.create),
  asyncHandler(async (req, res) => {
    const {
      asset_tag,
      serial_number,
      product_id,
      assigned_to,
      status = 'available',
      condition_status = 'good',
      purchase_date,
      warranty_end_date,
      purchase_cost,
      notes,
      is_active = true,
      // Component hierarchy fields
      asset_type = 'standalone',
      parent_asset_id,
      installation_notes,
      installed_by
    } = req.body;

    const pool = await connectDB();

    // Validate component-specific rules
    if (asset_type === 'component') {
      // Note: parent_asset_id is optional - components can be spare/stock without a parent
      // Parent is only required when installing the component
      if (assigned_to) {
        return sendError(res, 'Components cannot be assigned to users', 400);
      }
    }

    // Validate non-component cannot have parent
    if (asset_type !== 'component' && parent_asset_id) {
      return sendError(res, 'Only components can have a parent asset', 400);
    }

    // Check if serial number already exists
    if (serial_number) {
      const serialResult = await pool.request()
        .input('serialNumber', sql.VarChar(100), serial_number.trim())
        .query('SELECT id FROM assets WHERE serial_number = @serialNumber');

      if (serialResult.recordset.length > 0) {
        return sendConflict(res, 'Serial number already exists');
      }
    }

    // Verify that referenced entities exist and get product name for asset_tag generation
    const referencesResult = await pool.request()
      .input('productId', sql.UniqueIdentifier, product_id)
      .input('assignedTo', sql.UniqueIdentifier, assigned_to)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM products WHERE id = @productId AND is_active = 1) as product_exists,
          (SELECT name FROM products WHERE id = @productId AND is_active = 1) as product_name,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_id = @assignedTo AND is_active = 1) as user_exists
      `);

    const refs = referencesResult.recordset[0];

    if (refs.product_exists === 0) {
      return sendNotFound(res, 'Product not found or inactive');
    }

    if (assigned_to && refs.user_exists === 0) {
      return sendNotFound(res, 'User not found or inactive');
    }

    // Auto-generate asset_tag if not provided
    const finalAssetTag = asset_tag && asset_tag.trim()
      ? asset_tag.trim()
      : await generateUniqueAssetTag(refs.product_name, product_id);

    // Validate status logic
    if (status === 'assigned' && !assigned_to) {
      return sendError(res, 'Assigned user is required when status is "assigned"', 400);
    }

    if (assigned_to && status === 'available') {
      return sendError(res, 'Status cannot be "available" when user is assigned', 400);
    }

    // Generate unique tag_no - get location from assigned user if available
    let userLocationId = null;
    if (assigned_to) {
      const userResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, assigned_to)
        .query('SELECT location_id FROM USER_MASTER WHERE user_id = @userId');
      if (userResult.recordset.length > 0) {
        userLocationId = userResult.recordset[0].location_id;
      }
    }
    const tagNo = await generateUniqueTagNo(finalAssetTag, userLocationId);

    // Generate asset ID upfront
    const assetId = uuidv4();

    // Validate component installation if it's a component
    if (asset_type === 'component' && parent_asset_id) {
      const validationResult = await pool.request()
        .input('component_id', sql.UniqueIdentifier, assetId)
        .input('parent_id', sql.UniqueIdentifier, parent_asset_id)
        .output('is_valid', sql.Bit)
        .output('error_message', sql.VarChar(500))
        .execute('sp_validate_component_installation');

      if (!validationResult.output.is_valid) {
        return sendError(res, validationResult.output.error_message, 400);
      }
    }

    // Determine final status for components (always 'in_use' when installed)
    const finalStatus = asset_type === 'component' ? 'in_use' : status;
    const performedBy = installed_by || req.user?.user_id;
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, assetId)
      .input('assetTag', sql.VarChar(50), finalAssetTag)
      .input('tagNo', sql.VarChar(100), tagNo)
      .input('serialNumber', sql.VarChar(100), serial_number ? serial_number.trim() : null)
      .input('productId', sql.UniqueIdentifier, product_id)
      .input('assignedTo', sql.UniqueIdentifier, assigned_to)
      .input('status', sql.VarChar(20), finalStatus)
      .input('conditionStatus', sql.VarChar(20), condition_status)
      .input('purchaseDate', sql.Date, purchase_date)
      .input('warrantyEndDate', sql.Date, warranty_end_date)
      .input('purchaseCost', sql.Decimal(10, 2), purchase_cost)
      .input('notes', sql.NVarChar(sql.MAX), notes)
      .input('isActive', sql.Bit, is_active)
      .input('assetType', sql.VarChar(20), asset_type)
      .input('parentAssetId', sql.UniqueIdentifier, parent_asset_id)
      .input('installationDate', sql.DateTime, asset_type === 'component' ? new Date() : null)
      .input('installationNotes', sql.Text, installation_notes)
      .input('installedBy', sql.UniqueIdentifier, performedBy)
      .query(`
        INSERT INTO assets (
          id, asset_tag, tag_no, serial_number, product_id, assigned_to, status, condition_status,
          purchase_date, warranty_end_date, purchase_cost, notes, is_active,
          asset_type, parent_asset_id, installation_date, installation_notes, installed_by,
          created_at, updated_at
        )
        VALUES (
          @id, @assetTag, @tagNo, @serialNumber, @productId, @assignedTo, @status, @conditionStatus,
          @purchaseDate, @warrantyEndDate, @purchaseCost, @notes, @isActive,
          @assetType, @parentAssetId, @installationDate, @installationNotes, @installedBy,
          GETUTCDATE(), GETUTCDATE()
        );

        SELECT
          a.id, a.asset_tag, a.serial_number, a.status, a.condition_status, a.purchase_date, a.warranty_end_date,
          a.purchase_cost, a.notes, a.asset_type, a.parent_asset_id, a.installation_date,
          a.installation_notes, a.created_at, a.updated_at,
          p.name as product_name, p.model as product_model,
          l.name as location_name,
          u.first_name + ' ' + u.last_name as assigned_user_name, u.email as assigned_user_email,
          c.name as category_name,
          o.name as oem_name,
          parent.asset_tag as parent_asset_tag,
          installer.first_name + ' ' + installer.last_name as installed_by_name
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
        LEFT JOIN locations l ON u.location_id = l.id
        LEFT JOIN assets parent ON a.parent_asset_id = parent.id
        LEFT JOIN USER_MASTER installer ON a.installed_by = installer.user_id
        WHERE a.id = @id;
      `);

    sendCreated(res, result.recordset[0], 'Asset created successfully');
  })
);

// PUT /assets/:id - Update asset
router.put('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(validators.asset.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      asset_tag,
      serial_number,
      product_id,
      assigned_to,
      status,
      condition_status,
      purchase_date,
      warranty_end_date,
      purchase_cost,
      notes,
      is_active,
      // Component hierarchy fields
      asset_type,
      parent_asset_id,
      installation_notes,
      installed_by
    } = req.body;

    const pool = await connectDB();

    // Check if asset exists and get current children count
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          a.*,
          (SELECT COUNT(*) FROM assets WHERE parent_asset_id = a.id AND is_active = 1 AND removal_date IS NULL) as children_count
        FROM assets a
        WHERE a.id = @id AND a.is_active = 1
      `);

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const existingAsset = existingResult.recordset[0];

    // Validate component hierarchy changes
    if (asset_type !== undefined) {
      // Prevent changing asset_type if asset has children installed
      if (existingAsset.children_count > 0 && asset_type !== 'parent') {
        return sendError(res, 'Cannot change asset type - this asset has installed components. Remove all components first.', 400);
      }

      // Validate component-specific rules
      if (asset_type === 'component') {
        const finalParentId = parent_asset_id !== undefined ? parent_asset_id : existingAsset.parent_asset_id;
        if (!finalParentId) {
          return sendError(res, 'Components must have a parent_asset_id', 400);
        }
        if (assigned_to !== undefined && assigned_to !== null) {
          return sendError(res, 'Components cannot be assigned to users', 400);
        }
      }

      // Validate non-component cannot have parent
      if (asset_type !== 'component') {
        if (parent_asset_id !== undefined && parent_asset_id !== null) {
          return sendError(res, 'Only components can have a parent asset', 400);
        }
      }
    }

    // Validate parent_asset_id change if asset is already a component
    if (parent_asset_id !== undefined && existingAsset.asset_type === 'component') {
      // Changing parent for an existing component - validate using stored procedure
      if (parent_asset_id !== existingAsset.parent_asset_id) {
        const validationResult = await pool.request()
          .input('component_id', sql.UniqueIdentifier, id)
          .input('parent_id', sql.UniqueIdentifier, parent_asset_id)
          .output('is_valid', sql.Bit)
          .output('error_message', sql.VarChar(500))
          .execute('sp_validate_component_installation');

        if (!validationResult.output.is_valid) {
          return sendError(res, validationResult.output.error_message, 400);
        }
      }
    }

    // Check for asset tag conflict if being updated
    if (asset_tag && asset_tag.trim() !== existingAsset.asset_tag) {
      const conflictResult = await pool.request()
        .input('assetTag', sql.VarChar(50), asset_tag.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT id FROM assets WHERE asset_tag = @assetTag AND id != @id');

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'Asset tag already exists');
      }
    }

    // Check for serial number conflict if being updated
    if (serial_number && serial_number.trim() !== existingAsset.serial_number) {
      const serialConflictResult = await pool.request()
        .input('serialNumber', sql.VarChar(100), serial_number.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT id FROM assets WHERE serial_number = @serialNumber AND id != @id');

      if (serialConflictResult.recordset.length > 0) {
        return sendConflict(res, 'Serial number already exists');
      }
    }

    // Verify that referenced entities exist (if being updated)
    if (product_id || assigned_to) {
      const referencesRequest = pool.request();

      let referencesQuery = 'SELECT ';
      const checks = [];

      if (product_id) {
        checks.push('(SELECT COUNT(*) FROM products WHERE id = @productId AND is_active = 1) as product_exists');
        referencesRequest.input('productId', sql.UniqueIdentifier, product_id);
      }
      if (assigned_to) {
        checks.push('(SELECT COUNT(*) FROM USER_MASTER WHERE user_id = @assignedTo AND is_active = 1) as user_exists');
        referencesRequest.input('assignedTo', sql.UniqueIdentifier, assigned_to);
      }

      referencesQuery += checks.join(', ');

      const referencesResult = await referencesRequest.query(referencesQuery);
      const refs = referencesResult.recordset[0];

      if (product_id && refs.product_exists === 0) {
        return sendNotFound(res, 'Product not found or inactive');
      }
      if (assigned_to && refs.user_exists === 0) {
        return sendNotFound(res, 'User not found or inactive');
      }
    }

    // Validate status logic
    const finalStatus = status || existingAsset.status;
    const finalAssignedTo = assigned_to !== undefined ? assigned_to : existingAsset.assigned_to;

    if (finalStatus === 'assigned' && !finalAssignedTo) {
      return sendError(res, 'Assigned user is required when status is "assigned"', 400);
    }

    if (finalAssignedTo && finalStatus === 'available') {
      return sendError(res, 'Status cannot be "available" when user is assigned', 400);
    }

    // Build update query dynamically
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (asset_tag !== undefined) {
      updateFields.push('asset_tag = @assetTag');
      updateRequest.input('assetTag', sql.VarChar(50), asset_tag.trim());
    }
    if (serial_number !== undefined) {
      updateFields.push('serial_number = @serialNumber');
      updateRequest.input('serialNumber', sql.VarChar(100), serial_number ? serial_number.trim() : null);
    }
    if (product_id !== undefined) {
      updateFields.push('product_id = @productId');
      updateRequest.input('productId', sql.UniqueIdentifier, product_id);
    }
    if (assigned_to !== undefined) {
      updateFields.push('assigned_to = @assignedTo');
      updateRequest.input('assignedTo', sql.UniqueIdentifier, assigned_to);
    }
    if (status !== undefined) {
      updateFields.push('status = @status');
      updateRequest.input('status', sql.VarChar(20), status);
    }
    if (condition_status !== undefined) {
      updateFields.push('condition_status = @conditionStatus');
      updateRequest.input('conditionStatus', sql.VarChar(20), condition_status);
    }
    if (purchase_date !== undefined) {
      updateFields.push('purchase_date = @purchaseDate');
      updateRequest.input('purchaseDate', sql.Date, purchase_date);
    }
    if (warranty_end_date !== undefined) {
      updateFields.push('warranty_end_date = @warrantyEndDate');
      updateRequest.input('warrantyEndDate', sql.Date, warranty_end_date);
    }
    if (purchase_cost !== undefined) {
      updateFields.push('purchase_cost = @purchaseCost');
      updateRequest.input('purchaseCost', sql.Decimal(10, 2), purchase_cost);
    }
    if (notes !== undefined) {
      updateFields.push('notes = @notes');
      updateRequest.input('notes', sql.NVarChar(sql.MAX), notes);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = @isActive');
      updateRequest.input('isActive', sql.Bit, is_active);
    }
    // Component hierarchy fields
    if (asset_type !== undefined) {
      updateFields.push('asset_type = @assetType');
      updateRequest.input('assetType', sql.VarChar(20), asset_type);
    }
    if (parent_asset_id !== undefined) {
      updateFields.push('parent_asset_id = @parentAssetId');
      updateRequest.input('parentAssetId', sql.UniqueIdentifier, parent_asset_id);
      // If moving component to new parent, update installation_date
      if (parent_asset_id && existingAsset.asset_type === 'component') {
        updateFields.push('installation_date = GETUTCDATE()');
      }
    }
    if (installation_notes !== undefined) {
      updateFields.push('installation_notes = @installationNotes');
      updateRequest.input('installationNotes', sql.Text, installation_notes);
    }
    if (installed_by !== undefined) {
      updateFields.push('installed_by = @installedBy');
      updateRequest.input('installedBy', sql.UniqueIdentifier, installed_by);
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const result = await updateRequest.query(`
      UPDATE assets
      SET ${updateFields.join(', ')}
      WHERE id = @id;

      SELECT
        a.id, a.asset_tag, a.serial_number, a.status, a.condition_status, a.purchase_date, a.warranty_end_date,
        a.purchase_cost, a.notes, a.asset_type, a.parent_asset_id, a.installation_date,
        a.installation_notes, a.created_at, a.updated_at,
        u.location_id, a.assigned_to,
        p.name as product_name, p.model as product_model,
        l.name as location_name,
        u.first_name + ' ' + u.last_name as assigned_user_name, u.email as assigned_user_email,
        c.name as category_name,
        o.name as oem_name,
        parent.asset_tag as parent_asset_tag,
        installer.first_name + ' ' + installer.last_name as installed_by_name
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN assets parent ON a.parent_asset_id = parent.id
      LEFT JOIN USER_MASTER installer ON a.installed_by = installer.user_id
      WHERE a.id = @id;
    `);

    const updatedAsset = result.recordset[0];

    // Log movement if assignment changed
    const assignmentChanged = assigned_to !== undefined && existingAsset.assigned_to !== finalAssignedTo;

    if (assignmentChanged) {
      await logAssetAssignmentChange(
        updatedAsset,
        existingAsset,
        req.user.user_id
      );
    }

    sendSuccess(res, updatedAsset, 'Asset updated successfully');
  })
);

// DELETE /assets/:id - Delete asset (soft delete)
router.delete('/:id',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if asset exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, status FROM assets WHERE id = @id AND is_active = 1');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const asset = existingResult.recordset[0];

    // Check if asset is currently assigned
    if (asset.status === 'assigned') {
      return sendConflict(res, 'Cannot delete asset. It is currently assigned to a user.');
    }

    // Soft delete - mark as inactive
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE assets
        SET is_active = 0, updated_at = GETUTCDATE(), assigned_to = NULL
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Asset deleted successfully');
  })
);

// POST /assets/:id/assign - Assign asset to user
router.post('/:id/assign',
  requireDynamicPermission(),
  validateUUID('id'),
  validateBody(Joi.object({
    user_id: Joi.string().uuid().required(),
    notes: Joi.string().max(500).optional()
  })),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.body;

    const pool = await connectDB();

    // Check if asset exists and is available
    const assetResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, asset_tag, status, assigned_to, asset_type
        FROM assets
        WHERE id = @id AND is_active = 1
      `);

    if (assetResult.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const asset = assetResult.recordset[0];

    // Components cannot be assigned to users - they must be installed into parent assets
    if (asset.asset_type === 'component') {
      return sendConflict(res, 'Components cannot be assigned directly to users. Components must be installed into parent assets.');
    }

    // Allow assignment if status is: available, in_use, or assigned (for reassignment)
    if (asset.status !== 'available' && asset.status !== 'in_use' && asset.status !== 'assigned') {
      return sendConflict(res, 'Asset is not available for assignment. Current status: ' + asset.status);
    }

    if (asset.assigned_to === user_id) {
      return sendConflict(res, 'Asset is already assigned to this user');
    }

    // Verify user exists and get their location
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, user_id)
      .query('SELECT user_id, first_name, last_name, email, location_id FROM USER_MASTER WHERE user_id = @userId AND is_active = 1');

    if (userResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found or inactive');
    }

    const user = userResult.recordset[0];

    // Update asset assignment - asset inherits location from user
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.UniqueIdentifier, user_id)
      .query(`
        UPDATE assets
        SET assigned_to = @userId, status = 'assigned', updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    // Log assignment movement
    const updatedAssetData = {
      id: id,
      asset_tag: asset.asset_tag,
      assigned_to: user_id,
      location_id: user.location_id,
      status: 'assigned'
    };

    const previousData = {
      assigned_to: asset.assigned_to,
      location_id: null  // Assets no longer have their own location_id
    };

    await logAssetAssignmentChange(
      updatedAssetData,
      previousData,
      req.user?.id || req.user?.user_id
    );

    sendSuccess(res, {
      asset_id: id,
      asset_tag: asset.asset_tag,
      assigned_to: {
        user_id: user.user_id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email
      },
      assigned_at: new Date().toISOString()
    }, 'Asset assigned successfully');
  })
);

// POST /assets/:id/unassign - Unassign asset from user
router.post('/:id/unassign',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if asset exists and is assigned
    const assetResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, asset_tag, status, assigned_to
        FROM assets
        WHERE id = @id AND is_active = 1
      `);

    if (assetResult.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const asset = assetResult.recordset[0];

    if (asset.status !== 'assigned' && asset.assigned_to === null) {
      return sendConflict(res, 'Asset is not currently assigned');
    }

    // Update asset to unassign
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE assets
        SET assigned_to = NULL, status = 'available', updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    // Log unassignment movement
    const updatedAssetData = {
      id: id,
      asset_tag: asset.asset_tag,
      assigned_to: null,
      location_id: null,
      status: 'available'
    };

    const previousData = {
      assigned_to: asset.assigned_to,
      location_id: null
    };

    await logAssetAssignmentChange(
      updatedAssetData,
      previousData,
      req.user?.id || req.user?.user_id
    );

    sendSuccess(res, {
      asset_id: id,
      asset_tag: asset.asset_tag,
      unassigned_at: new Date().toISOString()
    }, 'Asset unassigned successfully');
  })
);

// POST /assets/:id/restore - Restore soft deleted asset
router.post('/:id/restore',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if asset exists and is soft deleted
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, asset_tag, status FROM assets WHERE id = @id AND is_active = 0');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'Deleted asset not found');
    }

    // Restore asset - mark as active and set to available status
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE assets
        SET is_active = 1, status = 'available', updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    sendSuccess(res, null, 'Asset restored successfully');
  })
);

module.exports = router;