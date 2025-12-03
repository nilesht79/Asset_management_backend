const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { connectDB, sql } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { validatePagination } = require('../../middleware/validation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// =====================================================
// CONSUMABLE CATEGORIES
// =====================================================

/**
 * GET /consumables/categories
 * Get all consumable categories
 */
router.get('/categories',
  asyncHandler(async (req, res) => {
    const { is_active } = req.query;
    const pool = await connectDB();

    let query = 'SELECT * FROM consumable_categories WHERE 1=1';
    const request = pool.request();

    if (is_active !== undefined) {
      query += ' AND is_active = @is_active';
      request.input('is_active', sql.Bit, is_active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY name';
    const result = await request.query(query);

    sendSuccess(res, { categories: result.recordset }, 'Categories retrieved successfully');
  })
);

/**
 * POST /consumables/categories
 * Create a new consumable category
 */
router.post('/categories',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    if (!name) {
      return sendError(res, 'Category name is required', 400);
    }

    const pool = await connectDB();
    const newId = uuidv4();

    await pool.request()
      .input('id', sql.UniqueIdentifier, newId)
      .input('name', sql.VarChar(100), name)
      .input('description', sql.VarChar(500), description || null)
      .query(`
        INSERT INTO consumable_categories (id, name, description)
        VALUES (@id, @name, @description)
      `);

    sendCreated(res, { id: newId, name, description }, 'Category created successfully');
  })
);

/**
 * PUT /consumables/categories/:id
 * Update a consumable category
 */
router.put('/categories/:id',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    const pool = await connectDB();

    const updates = [];
    const request = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updates.push('name = @name');
      request.input('name', sql.VarChar(100), name);
    }
    if (description !== undefined) {
      updates.push('description = @description');
      request.input('description', sql.VarChar(500), description);
    }
    if (is_active !== undefined) {
      updates.push('is_active = @is_active');
      request.input('is_active', sql.Bit, is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updates.push('updated_at = GETUTCDATE()');

    await request.query(`UPDATE consumable_categories SET ${updates.join(', ')} WHERE id = @id`);

    sendSuccess(res, null, 'Category updated successfully');
  })
);

// =====================================================
// ASSET-BASED CONSUMABLE LOOKUP (must be before /:id routes)
// =====================================================

/**
 * GET /consumables/for-asset/:assetId
 * Get compatible consumables for an asset (based on its product)
 */
router.get('/for-asset/:assetId',
  asyncHandler(async (req, res) => {
    const { assetId } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('asset_id', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT
          c.*,
          cc.name as category_name,
          COALESCE(SUM(ci.quantity_in_stock), 0) as total_stock
        FROM consumables c
        JOIN consumable_compatibility cp ON c.id = cp.consumable_id
        JOIN assets a ON a.product_id = cp.product_id
        JOIN consumable_categories cc ON c.category_id = cc.id
        LEFT JOIN consumable_inventory ci ON c.id = ci.consumable_id
        WHERE a.id = @asset_id AND c.is_active = 1
        GROUP BY c.id, c.name, c.sku, c.category_id, c.description, c.unit_of_measure,
                 c.reorder_level, c.unit_cost, c.vendor_id, c.is_active, c.created_at, c.updated_at,
                 cc.name
        ORDER BY c.name
      `);

    sendSuccess(res, result.recordset, 'Compatible consumables retrieved');
  })
);

/**
 * GET /consumables/inventory/low-stock
 * Get all items with low stock per location (must be before /:id routes)
 */
router.get('/inventory/low-stock',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request()
      .query(`
        SELECT
          c.id, c.name, c.sku, c.reorder_level, c.unit_of_measure,
          cc.name as category_name,
          ci.location_id,
          l.name as location_name,
          COALESCE(ci.quantity_in_stock, 0) as total_stock,
          c.reorder_level - COALESCE(ci.quantity_in_stock, 0) as shortage
        FROM consumables c
        LEFT JOIN consumable_categories cc ON c.category_id = cc.id
        LEFT JOIN consumable_inventory ci ON c.id = ci.consumable_id
        LEFT JOIN locations l ON ci.location_id = l.id
        WHERE c.is_active = 1
          AND COALESCE(ci.quantity_in_stock, 0) <= c.reorder_level
        ORDER BY shortage DESC, c.name, l.name
      `);

    sendSuccess(res, { low_stock_items: result.recordset }, 'Low stock items retrieved');
  })
);

/**
 * GET /consumables/inventory
 * Get all consumables with their inventory levels (must be before /:id routes)
 */
router.get('/inventory',
  validatePagination,
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { search, category_id, low_stock } = req.query;
    const pool = await connectDB();

    let whereClause = 'WHERE c.is_active = 1';
    const request = pool.request();

    if (search) {
      whereClause += ` AND (c.name LIKE @search OR c.sku LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    if (category_id) {
      whereClause += ` AND c.category_id = @category_id`;
      request.input('category_id', sql.UniqueIdentifier, category_id);
    }

    let havingClause = '';
    if (low_stock === 'true') {
      havingClause = 'HAVING COALESCE(SUM(ci.quantity_in_stock), 0) <= c.reorder_level';
    }

    // Get total count
    const countResult = await pool.request()
      .query(`
        SELECT COUNT(DISTINCT c.id) as total
        FROM consumables c
        ${whereClause.replace('@search', `'%${search || ''}%'`).replace('@category_id', `'${category_id || ''}'`)}
      `);
    const total = countResult.recordset[0].total;

    // Get paginated results with inventory info (per location)
    const result = await request
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT
          c.id, c.name, c.sku, c.category_id, c.vendor_id, c.unit_of_measure,
          c.reorder_level, c.unit_cost, c.description, c.is_active,
          cc.name as category_name,
          v.name as vendor_name,
          ci.location_id,
          l.name as location_name,
          COALESCE(ci.quantity_in_stock, 0) as total_stock,
          CASE
            WHEN COALESCE(ci.quantity_in_stock, 0) <= c.reorder_level THEN 1
            ELSE 0
          END as is_low_stock,
          c.created_at, c.updated_at
        FROM consumables c
        LEFT JOIN consumable_categories cc ON c.category_id = cc.id
        LEFT JOIN vendors v ON c.vendor_id = v.id
        LEFT JOIN consumable_inventory ci ON c.id = ci.consumable_id
        LEFT JOIN locations l ON ci.location_id = l.id
        ${whereClause}
        ${havingClause}
        ORDER BY c.name, l.name
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    sendSuccess(res, {
      inventory: result.recordset,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }, 'Inventory retrieved successfully');
  })
);

/**
 * POST /consumables/inventory/stock-in
 * Add stock for a consumable (must be before /:id routes)
 */
router.post('/inventory/stock-in',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { consumable_id, location_id, quantity, notes, reference_number } = req.body;

    if (!consumable_id || !quantity) {
      return sendError(res, 'Consumable ID and quantity are required', 400);
    }

    const pool = await connectDB();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const inventoryId = uuidv4();
      const transactionId = uuidv4();

      // Check if inventory record exists for this consumable/location
      const existingRequest = new sql.Request(transaction);
      const existing = await existingRequest
        .input('consumable_id', sql.UniqueIdentifier, consumable_id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .query(`
          SELECT id, quantity_in_stock FROM consumable_inventory
          WHERE consumable_id = @consumable_id
          AND (location_id = @location_id OR (@location_id IS NULL AND location_id IS NULL))
        `);

      if (existing.recordset.length > 0) {
        // Update existing inventory
        const updateRequest = new sql.Request(transaction);
        await updateRequest
          .input('id', sql.UniqueIdentifier, existing.recordset[0].id)
          .input('quantity', sql.Int, quantity)
          .input('restocked_by', sql.UniqueIdentifier, req.user.id)
          .query(`
            UPDATE consumable_inventory
            SET quantity_in_stock = quantity_in_stock + @quantity,
                last_restocked_at = GETUTCDATE(),
                last_restocked_by = @restocked_by,
                updated_at = GETUTCDATE()
            WHERE id = @id
          `);
      } else {
        // Create new inventory record
        const insertRequest = new sql.Request(transaction);
        await insertRequest
          .input('id', sql.UniqueIdentifier, inventoryId)
          .input('consumable_id', sql.UniqueIdentifier, consumable_id)
          .input('location_id', sql.UniqueIdentifier, location_id || null)
          .input('quantity', sql.Int, quantity)
          .input('restocked_by', sql.UniqueIdentifier, req.user.id)
          .query(`
            INSERT INTO consumable_inventory (id, consumable_id, location_id, quantity_in_stock, last_restocked_at, last_restocked_by)
            VALUES (@id, @consumable_id, @location_id, @quantity, GETUTCDATE(), @restocked_by)
          `);
      }

      // Get quantity before for transaction record
      const quantityBefore = existing.recordset.length > 0 ? existing.recordset[0].quantity_in_stock : 0;
      const quantityAfter = quantityBefore + quantity;

      // Record transaction
      const txnRequest = new sql.Request(transaction);
      await txnRequest
        .input('id', sql.UniqueIdentifier, transactionId)
        .input('consumable_id', sql.UniqueIdentifier, consumable_id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .input('transaction_type', sql.NVarChar, 'stock_in')
        .input('quantity', sql.Int, quantity)
        .input('quantity_before', sql.Int, quantityBefore)
        .input('quantity_after', sql.Int, quantityAfter)
        .input('notes', sql.NVarChar, notes ? `${reference_number ? `Ref: ${reference_number}. ` : ''}${notes}` : (reference_number || null))
        .input('performed_by', sql.UniqueIdentifier, req.user.id)
        .query(`
          INSERT INTO consumable_transactions
          (id, consumable_id, location_id, transaction_type, quantity, quantity_before, quantity_after, notes, performed_by)
          VALUES (@id, @consumable_id, @location_id, @transaction_type, @quantity, @quantity_before, @quantity_after, @notes, @performed_by)
        `);

      await transaction.commit();
      sendSuccess(res, { transaction_id: transactionId }, 'Stock added successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * POST /consumables/inventory/adjust
 * Adjust stock for a consumable (must be before /:id routes)
 * Accepts either 'adjustment' (delta) or 'new_quantity' (absolute value)
 */
router.post('/inventory/adjust',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { consumable_id, location_id, adjustment, new_quantity, reason, notes } = req.body;

    if (!consumable_id || (adjustment === undefined && new_quantity === undefined)) {
      return sendError(res, 'Consumable ID and adjustment or new_quantity are required', 400);
    }

    const pool = await connectDB();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const transactionId = uuidv4();

      // Get current inventory
      const currentRequest = new sql.Request(transaction);
      const current = await currentRequest
        .input('consumable_id', sql.UniqueIdentifier, consumable_id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .query(`
          SELECT id, quantity_in_stock, location_id FROM consumable_inventory
          WHERE consumable_id = @consumable_id
          AND (
            (@location_id IS NOT NULL AND location_id = @location_id) OR
            (@location_id IS NULL)
          )
          ORDER BY location_id
        `);

      if (current.recordset.length === 0) {
        await transaction.rollback();
        return sendError(res, 'No inventory record found for this consumable', 404);
      }

      const inventoryRecord = current.recordset[0];
      const currentStock = inventoryRecord.quantity_in_stock;
      const actualLocationId = inventoryRecord.location_id;
      // Calculate final quantity - use new_quantity if provided, otherwise apply adjustment
      const finalQuantity = new_quantity !== undefined ? new_quantity : (currentStock + adjustment);
      const adjustmentDelta = finalQuantity - currentStock;

      if (finalQuantity < 0) {
        await transaction.rollback();
        return sendError(res, 'Adjustment would result in negative stock', 400);
      }

      // Update inventory
      const updateRequest = new sql.Request(transaction);
      await updateRequest
        .input('id', sql.UniqueIdentifier, inventoryRecord.id)
        .input('new_quantity', sql.Int, finalQuantity)
        .query(`
          UPDATE consumable_inventory
          SET quantity_in_stock = @new_quantity, updated_at = GETUTCDATE()
          WHERE id = @id
        `);

      // Record transaction
      const txnRequest = new sql.Request(transaction);
      await txnRequest
        .input('id', sql.UniqueIdentifier, transactionId)
        .input('consumable_id', sql.UniqueIdentifier, consumable_id)
        .input('location_id', sql.UniqueIdentifier, actualLocationId)
        .input('transaction_type', sql.NVarChar, 'adjustment')
        .input('quantity', sql.Int, adjustmentDelta)
        .input('quantity_before', sql.Int, currentStock)
        .input('quantity_after', sql.Int, finalQuantity)
        .input('notes', sql.NVarChar, `${reason || 'Stock adjustment'}${notes ? ': ' + notes : ''}`)
        .input('performed_by', sql.UniqueIdentifier, req.user.id)
        .query(`
          INSERT INTO consumable_transactions
          (id, consumable_id, location_id, transaction_type, quantity, quantity_before, quantity_after, notes, performed_by)
          VALUES (@id, @consumable_id, @location_id, @transaction_type, @quantity, @quantity_before, @quantity_after, @notes, @performed_by)
        `);

      await transaction.commit();
      sendSuccess(res, { new_quantity: finalQuantity, adjustment: adjustmentDelta }, 'Stock adjusted successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * GET /consumables/transactions
 * Get all consumable transactions (must be before /:id routes)
 */
router.get('/transactions',
  validatePagination,
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { consumable_id, transaction_type, search } = req.query;
    const pool = await connectDB();

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (consumable_id) {
      whereClause += ` AND ct.consumable_id = @consumable_id`;
      request.input('consumable_id', sql.UniqueIdentifier, consumable_id);
    }

    if (transaction_type) {
      whereClause += ` AND ct.transaction_type = @transaction_type`;
      request.input('transaction_type', sql.NVarChar, transaction_type);
    }

    if (search) {
      whereClause += ` AND (c.name LIKE @search OR c.sku LIKE @search OR ct.reference_number LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    // Get total count
    const countRequest = pool.request();
    if (consumable_id) countRequest.input('consumable_id', sql.UniqueIdentifier, consumable_id);
    if (transaction_type) countRequest.input('transaction_type', sql.NVarChar, transaction_type);
    if (search) countRequest.input('search', sql.NVarChar, `%${search}%`);

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM consumable_transactions ct
      JOIN consumables c ON ct.consumable_id = c.id
      ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Get paginated results
    const result = await request
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT
          ct.*,
          c.name as consumable_name,
          c.sku as consumable_sku,
          l.name as location_name,
          u.first_name + ' ' + u.last_name as performed_by_name
        FROM consumable_transactions ct
        JOIN consumables c ON ct.consumable_id = c.id
        LEFT JOIN locations l ON ct.location_id = l.id
        LEFT JOIN USER_MASTER u ON ct.performed_by = u.user_id
        ${whereClause}
        ORDER BY ct.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    sendSuccess(res, {
      transactions: result.recordset,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }, 'Transactions retrieved successfully');
  })
);

// =====================================================
// CONSUMABLES MASTER
// =====================================================

/**
 * GET /consumables
 * Get all consumables with pagination and filters
 */
router.get('/',
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = req.pagination;
    const { search, category_id, vendor_id, is_active, low_stock } = req.query;

    const pool = await connectDB();

    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (c.name LIKE @search OR c.sku LIKE @search OR c.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (category_id) {
      whereClause += ' AND c.category_id = @category_id';
      params.push({ name: 'category_id', type: sql.UniqueIdentifier, value: category_id });
    }

    if (vendor_id) {
      whereClause += ' AND c.vendor_id = @vendor_id';
      params.push({ name: 'vendor_id', type: sql.UniqueIdentifier, value: vendor_id });
    }

    if (is_active !== undefined) {
      whereClause += ' AND c.is_active = @is_active';
      params.push({ name: 'is_active', type: sql.Bit, value: is_active === 'true' ? 1 : 0 });
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(p => countRequest.input(p.name, p.type, p.value));
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total FROM consumables c WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Get paginated data with joins
    const dataRequest = pool.request();
    params.forEach(p => dataRequest.input(p.name, p.type, p.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    let dataQuery = `
      SELECT
        c.*,
        cc.name as category_name,
        v.name as vendor_name,
        COALESCE(SUM(ci.quantity_in_stock), 0) as total_stock,
        COALESCE(SUM(ci.quantity_reserved), 0) as total_reserved
      FROM consumables c
      LEFT JOIN consumable_categories cc ON c.category_id = cc.id
      LEFT JOIN vendors v ON c.vendor_id = v.id
      LEFT JOIN consumable_inventory ci ON c.id = ci.consumable_id
      WHERE ${whereClause}
      GROUP BY c.id, c.name, c.sku, c.category_id, c.description, c.unit_of_measure,
               c.reorder_level, c.unit_cost, c.vendor_id, c.is_active, c.created_at, c.updated_at,
               cc.name, v.name
    `;

    if (low_stock === 'true') {
      dataQuery += ' HAVING COALESCE(SUM(ci.quantity_in_stock), 0) <= c.reorder_level';
    }

    dataQuery += `
      ORDER BY c.name
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    const result = await dataRequest.query(dataQuery);
    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      consumables: result.recordset,
      pagination
    }, 'Consumables retrieved successfully');
  })
);

/**
 * GET /consumables/:id
 * Get single consumable with details
 */
router.get('/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          c.*,
          cc.name as category_name,
          v.name as vendor_name
        FROM consumables c
        LEFT JOIN consumable_categories cc ON c.category_id = cc.id
        LEFT JOIN vendors v ON c.vendor_id = v.id
        WHERE c.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Consumable not found');
    }

    // Get inventory by location
    const inventoryResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT ci.*, l.name as location_name
        FROM consumable_inventory ci
        LEFT JOIN locations l ON ci.location_id = l.id
        WHERE ci.consumable_id = @id
      `);

    // Get compatible products
    const compatResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT cp.*, p.name as product_name, p.model as product_model, o.name as oem_name
        FROM consumable_compatibility cp
        JOIN products p ON cp.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        WHERE cp.consumable_id = @id
      `);

    sendSuccess(res, {
      ...result.recordset[0],
      inventory: inventoryResult.recordset,
      compatible_products: compatResult.recordset
    }, 'Consumable retrieved successfully');
  })
);

/**
 * POST /consumables
 * Create a new consumable
 */
router.post('/',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const {
      name, sku, category_id, description, unit_of_measure,
      reorder_level, unit_cost, vendor_id, compatible_product_ids
    } = req.body;

    if (!name || !category_id) {
      return sendError(res, 'Name and category are required', 400);
    }

    const pool = await connectDB();
    const newId = uuidv4();

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Create consumable
      await transaction.request()
        .input('id', sql.UniqueIdentifier, newId)
        .input('name', sql.VarChar(200), name)
        .input('sku', sql.VarChar(50), sku || null)
        .input('category_id', sql.UniqueIdentifier, category_id)
        .input('description', sql.VarChar(500), description || null)
        .input('unit_of_measure', sql.VarChar(50), unit_of_measure || 'pieces')
        .input('reorder_level', sql.Int, reorder_level || 10)
        .input('unit_cost', sql.Decimal(10, 2), unit_cost || null)
        .input('vendor_id', sql.UniqueIdentifier, vendor_id || null)
        .query(`
          INSERT INTO consumables (id, name, sku, category_id, description, unit_of_measure, reorder_level, unit_cost, vendor_id)
          VALUES (@id, @name, @sku, @category_id, @description, @unit_of_measure, @reorder_level, @unit_cost, @vendor_id)
        `);

      // Add product compatibility if provided
      if (compatible_product_ids && compatible_product_ids.length > 0) {
        for (const productId of compatible_product_ids) {
          await transaction.request()
            .input('id', sql.UniqueIdentifier, uuidv4())
            .input('consumable_id', sql.UniqueIdentifier, newId)
            .input('product_id', sql.UniqueIdentifier, productId)
            .query(`
              INSERT INTO consumable_compatibility (id, consumable_id, product_id)
              VALUES (@id, @consumable_id, @product_id)
            `);
        }
      }

      await transaction.commit();

      sendCreated(res, { id: newId, name }, 'Consumable created successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * PUT /consumables/:id
 * Update a consumable
 */
router.put('/:id',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      name, sku, category_id, description, unit_of_measure,
      reorder_level, unit_cost, vendor_id, is_active
    } = req.body;

    const pool = await connectDB();

    const updates = [];
    const request = pool.request().input('id', sql.UniqueIdentifier, id);

    if (name !== undefined) {
      updates.push('name = @name');
      request.input('name', sql.VarChar(200), name);
    }
    if (sku !== undefined) {
      updates.push('sku = @sku');
      request.input('sku', sql.VarChar(50), sku);
    }
    if (category_id !== undefined) {
      updates.push('category_id = @category_id');
      request.input('category_id', sql.UniqueIdentifier, category_id);
    }
    if (description !== undefined) {
      updates.push('description = @description');
      request.input('description', sql.VarChar(500), description);
    }
    if (unit_of_measure !== undefined) {
      updates.push('unit_of_measure = @unit_of_measure');
      request.input('unit_of_measure', sql.VarChar(50), unit_of_measure);
    }
    if (reorder_level !== undefined) {
      updates.push('reorder_level = @reorder_level');
      request.input('reorder_level', sql.Int, reorder_level);
    }
    if (unit_cost !== undefined) {
      updates.push('unit_cost = @unit_cost');
      request.input('unit_cost', sql.Decimal(10, 2), unit_cost);
    }
    if (vendor_id !== undefined) {
      updates.push('vendor_id = @vendor_id');
      request.input('vendor_id', sql.UniqueIdentifier, vendor_id);
    }
    if (is_active !== undefined) {
      updates.push('is_active = @is_active');
      request.input('is_active', sql.Bit, is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updates.push('updated_at = GETUTCDATE()');

    await request.query(`UPDATE consumables SET ${updates.join(', ')} WHERE id = @id`);

    sendSuccess(res, null, 'Consumable updated successfully');
  })
);

/**
 * DELETE /consumables/:id
 * Soft delete a consumable
 */
router.delete('/:id',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('UPDATE consumables SET is_active = 0, updated_at = GETUTCDATE() WHERE id = @id');

    sendSuccess(res, null, 'Consumable deleted successfully');
  })
);

// =====================================================
// COMPATIBILITY MANAGEMENT
// =====================================================

/**
 * GET /consumables/:id/compatibility
 * Get product compatibility for a consumable
 */
router.get('/:id/compatibility',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('consumable_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          cp.*,
          p.id as product_id,
          p.name as product_name,
          p.model as product_model,
          o.name as oem_name
        FROM consumable_compatibility cp
        JOIN products p ON cp.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        WHERE cp.consumable_id = @consumable_id
        ORDER BY p.name
      `);

    sendSuccess(res, result.recordset, 'Compatibility list retrieved successfully');
  })
);

/**
 * POST /consumables/:id/compatibility
 * Add product compatibility (supports single product_id or array of product_ids)
 * Replaces all existing compatibility when product_ids array is provided
 */
router.post('/:id/compatibility',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { product_id, product_ids, notes } = req.body;

    const pool = await connectDB();

    // If product_ids array is provided, replace all compatibility
    if (product_ids && Array.isArray(product_ids)) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // Delete existing compatibility
        const deleteRequest = new sql.Request(transaction);
        await deleteRequest
          .input('consumable_id', sql.UniqueIdentifier, id)
          .query('DELETE FROM consumable_compatibility WHERE consumable_id = @consumable_id');

        // Add new compatibility entries (only if there are products to add)
        for (let i = 0; i < product_ids.length; i++) {
          const prodId = product_ids[i];
          const insertRequest = new sql.Request(transaction);
          await insertRequest
            .input('id', sql.UniqueIdentifier, uuidv4())
            .input('consumable_id', sql.UniqueIdentifier, id)
            .input('product_id', sql.UniqueIdentifier, prodId)
            .query(`
              INSERT INTO consumable_compatibility (id, consumable_id, product_id)
              VALUES (@id, @consumable_id, @product_id)
            `);
        }

        await transaction.commit();
        sendSuccess(res, { count: product_ids.length }, 'Compatibility updated successfully');
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return;
    }

    // Single product_id handling (original behavior)
    if (!product_id) {
      return sendError(res, 'Product ID is required', 400);
    }

    // Check if already exists
    const existing = await pool.request()
      .input('consumable_id', sql.UniqueIdentifier, id)
      .input('product_id', sql.UniqueIdentifier, product_id)
      .query(`
        SELECT id FROM consumable_compatibility
        WHERE consumable_id = @consumable_id AND product_id = @product_id
      `);

    if (existing.recordset.length > 0) {
      return sendError(res, 'This product is already compatible', 409);
    }

    const newId = uuidv4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, newId)
      .input('consumable_id', sql.UniqueIdentifier, id)
      .input('product_id', sql.UniqueIdentifier, product_id)
      .input('notes', sql.VarChar(255), notes || null)
      .query(`
        INSERT INTO consumable_compatibility (id, consumable_id, product_id, notes)
        VALUES (@id, @consumable_id, @product_id, @notes)
      `);

    sendCreated(res, { id: newId }, 'Compatibility added successfully');
  })
);

/**
 * DELETE /consumables/:id/compatibility/:productId
 * Remove product compatibility
 */
router.delete('/:id/compatibility/:productId',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { id, productId } = req.params;
    const pool = await connectDB();

    await pool.request()
      .input('consumable_id', sql.UniqueIdentifier, id)
      .input('product_id', sql.UniqueIdentifier, productId)
      .query(`
        DELETE FROM consumable_compatibility
        WHERE consumable_id = @consumable_id AND product_id = @product_id
      `);

    sendSuccess(res, null, 'Compatibility removed successfully');
  })
);

// =====================================================
// INVENTORY MANAGEMENT
// =====================================================

/**
 * GET /consumables/:id/inventory
 * Get inventory levels for a consumable
 */
router.get('/:id/inventory',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT ci.*, l.name as location_name, l.address as location_address
        FROM consumable_inventory ci
        LEFT JOIN locations l ON ci.location_id = l.id
        WHERE ci.consumable_id = @id
        ORDER BY l.name
      `);

    sendSuccess(res, { inventory: result.recordset }, 'Inventory retrieved successfully');
  })
);

/**
 * POST /consumables/:id/inventory/stock-in
 * Add stock to inventory
 */
router.post('/:id/inventory/stock-in',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { location_id, quantity, notes } = req.body;

    if (!quantity || quantity <= 0) {
      return sendError(res, 'Valid quantity is required', 400);
    }

    const pool = await connectDB();
    const userId = req.user.id;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Check if inventory record exists for this location
      const existing = await transaction.request()
        .input('consumable_id', sql.UniqueIdentifier, id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .query(`
          SELECT id, quantity_in_stock FROM consumable_inventory
          WHERE consumable_id = @consumable_id AND
                (location_id = @location_id OR (@location_id IS NULL AND location_id IS NULL))
        `);

      let quantityBefore = 0;
      let quantityAfter = quantity;

      if (existing.recordset.length > 0) {
        quantityBefore = existing.recordset[0].quantity_in_stock;
        quantityAfter = quantityBefore + quantity;

        // Update existing inventory
        await transaction.request()
          .input('consumable_id', sql.UniqueIdentifier, id)
          .input('location_id', sql.UniqueIdentifier, location_id || null)
          .input('quantity', sql.Int, quantity)
          .input('user_id', sql.UniqueIdentifier, userId)
          .query(`
            UPDATE consumable_inventory
            SET quantity_in_stock = quantity_in_stock + @quantity,
                last_restocked_at = GETUTCDATE(),
                last_restocked_by = @user_id,
                updated_at = GETUTCDATE()
            WHERE consumable_id = @consumable_id AND
                  (location_id = @location_id OR (@location_id IS NULL AND location_id IS NULL))
          `);
      } else {
        // Create new inventory record
        await transaction.request()
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('consumable_id', sql.UniqueIdentifier, id)
          .input('location_id', sql.UniqueIdentifier, location_id || null)
          .input('quantity', sql.Int, quantity)
          .input('user_id', sql.UniqueIdentifier, userId)
          .query(`
            INSERT INTO consumable_inventory (id, consumable_id, location_id, quantity_in_stock, last_restocked_at, last_restocked_by)
            VALUES (@id, @consumable_id, @location_id, @quantity, GETUTCDATE(), @user_id)
          `);
      }

      // Log transaction
      await transaction.request()
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('consumable_id', sql.UniqueIdentifier, id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .input('quantity', sql.Int, quantity)
        .input('quantity_before', sql.Int, quantityBefore)
        .input('quantity_after', sql.Int, quantityAfter)
        .input('notes', sql.VarChar(500), notes || null)
        .input('user_id', sql.UniqueIdentifier, userId)
        .query(`
          INSERT INTO consumable_transactions
          (id, consumable_id, location_id, transaction_type, quantity, quantity_before, quantity_after, reference_type, notes, performed_by)
          VALUES (@id, @consumable_id, @location_id, 'stock_in', @quantity, @quantity_before, @quantity_after, 'manual', @notes, @user_id)
        `);

      await transaction.commit();

      sendSuccess(res, { quantity_after: quantityAfter }, 'Stock added successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * POST /consumables/:id/inventory/adjust
 * Adjust inventory (for corrections/audits)
 */
router.post('/:id/inventory/adjust',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { location_id, new_quantity, notes } = req.body;

    if (new_quantity === undefined || new_quantity < 0) {
      return sendError(res, 'Valid quantity is required', 400);
    }

    const pool = await connectDB();
    const userId = req.user.id;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Get current quantity
      const existing = await transaction.request()
        .input('consumable_id', sql.UniqueIdentifier, id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .query(`
          SELECT id, quantity_in_stock FROM consumable_inventory
          WHERE consumable_id = @consumable_id AND
                (location_id = @location_id OR (@location_id IS NULL AND location_id IS NULL))
        `);

      const quantityBefore = existing.recordset.length > 0 ? existing.recordset[0].quantity_in_stock : 0;
      const adjustmentAmount = new_quantity - quantityBefore;

      if (existing.recordset.length > 0) {
        await transaction.request()
          .input('consumable_id', sql.UniqueIdentifier, id)
          .input('location_id', sql.UniqueIdentifier, location_id || null)
          .input('quantity', sql.Int, new_quantity)
          .query(`
            UPDATE consumable_inventory
            SET quantity_in_stock = @quantity, updated_at = GETUTCDATE()
            WHERE consumable_id = @consumable_id AND
                  (location_id = @location_id OR (@location_id IS NULL AND location_id IS NULL))
          `);
      } else {
        await transaction.request()
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('consumable_id', sql.UniqueIdentifier, id)
          .input('location_id', sql.UniqueIdentifier, location_id || null)
          .input('quantity', sql.Int, new_quantity)
          .query(`
            INSERT INTO consumable_inventory (id, consumable_id, location_id, quantity_in_stock)
            VALUES (@id, @consumable_id, @location_id, @quantity)
          `);
      }

      // Log transaction
      await transaction.request()
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('consumable_id', sql.UniqueIdentifier, id)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .input('quantity', sql.Int, adjustmentAmount)
        .input('quantity_before', sql.Int, quantityBefore)
        .input('quantity_after', sql.Int, new_quantity)
        .input('notes', sql.VarChar(500), notes || 'Inventory adjustment')
        .input('user_id', sql.UniqueIdentifier, userId)
        .query(`
          INSERT INTO consumable_transactions
          (id, consumable_id, location_id, transaction_type, quantity, quantity_before, quantity_after, reference_type, notes, performed_by)
          VALUES (@id, @consumable_id, @location_id, 'adjustment', @quantity, @quantity_before, @quantity_after, 'adjustment', @notes, @user_id)
        `);

      await transaction.commit();

      sendSuccess(res, { quantity_after: new_quantity }, 'Inventory adjusted successfully');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

/**
 * GET /consumables/:id/transactions
 * Get transaction history for a consumable
 */
router.get('/:id/transactions',
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit, offset } = req.pagination;
    const pool = await connectDB();

    const countResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as total FROM consumable_transactions WHERE consumable_id = @id');

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT
          ct.*,
          l.name as location_name,
          u.first_name + ' ' + u.last_name as performed_by_name
        FROM consumable_transactions ct
        LEFT JOIN locations l ON ct.location_id = l.id
        LEFT JOIN USER_MASTER u ON ct.performed_by = u.user_id
        WHERE ct.consumable_id = @id
        ORDER BY ct.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const pagination = getPaginationInfo(page, limit, countResult.recordset[0].total);

    sendSuccess(res, {
      transactions: result.recordset,
      pagination
    }, 'Transactions retrieved successfully');
  })
);

module.exports = router;
