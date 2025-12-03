const express = require('express');
const { connectDB, sql } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendNotFound } = require('../../utils/response');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /settings/system-config
 * Get all system configuration values
 * Accessible by: admin, superadmin
 */
router.get('/',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { category } = req.query;

    const pool = await connectDB();

    let query = `
      SELECT id, config_key, config_value, description, category, is_editable, created_at, updated_at
      FROM system_config
    `;

    const request = pool.request();

    if (category) {
      query += ' WHERE category = @category';
      request.input('category', sql.VarChar(50), category);
    }

    query += ' ORDER BY category, config_key';

    const result = await request.query(query);

    // Group by category for easier frontend consumption
    const grouped = result.recordset.reduce((acc, config) => {
      if (!acc[config.category]) {
        acc[config.category] = [];
      }
      acc[config.category].push({
        id: config.id,
        key: config.config_key,
        value: config.config_value,
        description: config.description,
        category: config.category,
        isEditable: config.is_editable,
        createdAt: config.created_at,
        updatedAt: config.updated_at
      });
      return acc;
    }, {});

    sendSuccess(res, {
      configs: result.recordset.map(c => ({
        id: c.id,
        key: c.config_key,
        value: c.config_value,
        description: c.description,
        category: c.category,
        isEditable: c.is_editable,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      })),
      grouped
    }, 'System configuration retrieved successfully');
  })
);

/**
 * GET /settings/system-config/:key
 * Get a specific configuration value by key
 * Accessible by: admin, superadmin
 */
router.get('/:key',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { key } = req.params;

    const pool = await connectDB();

    const result = await pool.request()
      .input('key', sql.VarChar(100), key)
      .query(`
        SELECT id, config_key, config_value, description, category, is_editable, created_at, updated_at
        FROM system_config
        WHERE config_key = @key
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, `Configuration key '${key}' not found`);
    }

    const config = result.recordset[0];

    sendSuccess(res, {
      id: config.id,
      key: config.config_key,
      value: config.config_value,
      description: config.description,
      category: config.category,
      isEditable: config.is_editable,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    }, 'Configuration retrieved successfully');
  })
);

/**
 * PUT /settings/system-config/:key
 * Update a configuration value
 * Accessible by: superadmin only
 */
router.put('/:key',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return sendError(res, 'Configuration value is required', 400);
    }

    const pool = await connectDB();

    // Check if config exists and is editable
    const existing = await pool.request()
      .input('key', sql.VarChar(100), key)
      .query(`
        SELECT id, config_key, is_editable
        FROM system_config
        WHERE config_key = @key
      `);

    if (existing.recordset.length === 0) {
      return sendNotFound(res, `Configuration key '${key}' not found`);
    }

    if (!existing.recordset[0].is_editable) {
      return sendError(res, `Configuration '${key}' is not editable`, 403);
    }

    // Validate specific keys
    if (key === 'ASSET_CODE_ORG') {
      if (typeof value !== 'string' || value.length < 1 || value.length > 10) {
        return sendError(res, 'ORG code must be 1-10 characters', 400);
      }
    }

    if (key === 'ASSET_CODE_SUB_ORG') {
      if (typeof value !== 'string' || value.length < 1 || value.length > 5) {
        return sendError(res, 'SUB_ORG code must be 1-5 characters', 400);
      }
    }

    // Update the value
    const result = await pool.request()
      .input('key', sql.VarChar(100), key)
      .input('value', sql.VarChar(500), value.toString())
      .query(`
        UPDATE system_config
        SET config_value = @value, updated_at = GETUTCDATE()
        WHERE config_key = @key;

        SELECT id, config_key, config_value, description, category, is_editable, created_at, updated_at
        FROM system_config
        WHERE config_key = @key;
      `);

    const config = result.recordset[0];

    sendSuccess(res, {
      id: config.id,
      key: config.config_key,
      value: config.config_value,
      description: config.description,
      category: config.category,
      isEditable: config.is_editable,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    }, 'Configuration updated successfully');
  })
);

/**
 * POST /settings/system-config
 * Create a new configuration (superadmin only)
 */
router.post('/',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { key, value, description, category = 'general', isEditable = true } = req.body;

    if (!key || !value) {
      return sendError(res, 'Configuration key and value are required', 400);
    }

    const pool = await connectDB();

    // Check if key already exists
    const existing = await pool.request()
      .input('key', sql.VarChar(100), key)
      .query('SELECT id FROM system_config WHERE config_key = @key');

    if (existing.recordset.length > 0) {
      return sendError(res, `Configuration key '${key}' already exists`, 409);
    }

    const result = await pool.request()
      .input('key', sql.VarChar(100), key)
      .input('value', sql.VarChar(500), value.toString())
      .input('description', sql.VarChar(500), description || null)
      .input('category', sql.VarChar(50), category)
      .input('is_editable', sql.Bit, isEditable ? 1 : 0)
      .query(`
        INSERT INTO system_config (config_key, config_value, description, category, is_editable)
        VALUES (@key, @value, @description, @category, @is_editable);

        SELECT id, config_key, config_value, description, category, is_editable, created_at, updated_at
        FROM system_config
        WHERE config_key = @key;
      `);

    const config = result.recordset[0];

    sendSuccess(res, {
      id: config.id,
      key: config.config_key,
      value: config.config_value,
      description: config.description,
      category: config.category,
      isEditable: config.is_editable,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    }, 'Configuration created successfully', 201);
  })
);

/**
 * GET /settings/system-config/asset-code/preview
 * Preview asset code format with current ORG/SUB_ORG settings
 */
router.get('/asset-code/preview',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request()
      .query(`
        SELECT config_key, config_value
        FROM system_config
        WHERE config_key IN ('ASSET_CODE_ORG', 'ASSET_CODE_SUB_ORG')
      `);

    const configMap = result.recordset.reduce((acc, c) => {
      acc[c.config_key] = c.config_value;
      return acc;
    }, {});

    const org = configMap['ASSET_CODE_ORG'] || 'CID';
    const subOrg = configMap['ASSET_CODE_SUB_ORG'] || '0';

    // Generate sample preview
    const sampleCode = `${org}/${subOrg}/IT/BK-DT/HP/1234`;

    sendSuccess(res, {
      org,
      subOrg,
      format: '{ORG}/{SUB_ORG}/{DEPT}/{LOC}-{TYPE}/{OEM}/{NUM}',
      sample: sampleCode,
      breakdown: {
        org: { code: org, description: 'Organization Code' },
        subOrg: { code: subOrg, description: 'Sub-Organization Code' },
        department: { code: 'IT', description: 'Department (from assigned user)' },
        location: { code: 'BK', description: 'Location (from assigned user)' },
        assetType: { code: 'DT', description: 'Asset Type (Desktop)' },
        oem: { code: 'HP', description: 'OEM/Manufacturer' },
        assetNumber: { code: '1234', description: 'Last 4 digits of serial' }
      }
    }, 'Asset code preview generated');
  })
);

module.exports = router;
