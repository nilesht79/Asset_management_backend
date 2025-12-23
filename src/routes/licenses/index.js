const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validatePagination, validateUUID } = require('../../middleware/validation');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendConflict } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// =====================================================
// UTILIZATION REPORT (must be before /:id routes)
// =====================================================

/**
 * GET /licenses/utilization-report
 * Get license utilization report: Purchased vs Allocated
 */
router.get('/utilization-report',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        sl.id,
        sl.license_name,
        sl.license_type,
        sl.total_licenses as purchased,
        p.name as product_name,
        p.model as product_model,
        o.name as oem_name,
        v.name as vendor_name,
        sl.purchase_date,
        sl.expiration_date,
        sl.is_active,
        COUNT(asi.id) as allocated,
        sl.total_licenses - COUNT(asi.id) as available,
        CASE
          WHEN sl.total_licenses > 0
          THEN CAST(ROUND(COUNT(asi.id) * 100.0 / sl.total_licenses, 1) AS DECIMAL(5,1))
          ELSE 0
        END as utilization_percent
      FROM software_licenses sl
      JOIN products p ON sl.product_id = p.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN vendors v ON sl.vendor_id = v.id
      LEFT JOIN asset_software_installations asi ON asi.license_id = sl.id AND asi.is_active = 1
      WHERE sl.is_active = 1
      GROUP BY
        sl.id, sl.license_name, sl.license_type, sl.total_licenses,
        p.name, p.model, o.name, v.name,
        sl.purchase_date, sl.expiration_date, sl.is_active
      ORDER BY utilization_percent DESC, sl.license_name
    `);

    // Calculate summary statistics
    const summary = {
      total_licenses: 0,
      total_purchased: 0,
      total_allocated: 0,
      total_available: 0,
      average_utilization: 0,
      expiring_soon: 0,
      over_allocated: 0
    };

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    result.recordset.forEach(license => {
      summary.total_licenses++;
      summary.total_purchased += license.purchased;
      summary.total_allocated += license.allocated;
      summary.total_available += license.available;

      if (license.expiration_date && new Date(license.expiration_date) <= thirtyDaysFromNow) {
        summary.expiring_soon++;
      }

      if (license.allocated > license.purchased) {
        summary.over_allocated++;
      }
    });

    if (summary.total_purchased > 0) {
      summary.average_utilization = Math.round(summary.total_allocated * 100 / summary.total_purchased);
    }

    sendSuccess(res, {
      licenses: result.recordset,
      summary
    }, 'License utilization report generated');
  })
);

/**
 * GET /licenses/usage-analytics
 * Get license usage analytics - Purchased vs Peak Usage (Monthly/Quarterly)
 * Query params: period = 'monthly' | 'quarterly', months = number of months to look back (default 12)
 */
router.get('/usage-analytics',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { period = 'monthly', months = 12 } = req.query;
    const pool = await connectDB();

    // Get all active licenses with their purchased counts
    const licensesResult = await pool.request().query(`
      SELECT
        sl.id,
        sl.license_name,
        sl.license_type,
        sl.total_licenses as purchased,
        p.name as product_name,
        p.model as product_model,
        o.name as oem_name,
        sl.purchase_date,
        sl.expiration_date
      FROM software_licenses sl
      JOIN products p ON sl.product_id = p.id
      LEFT JOIN oems o ON p.oem_id = o.id
      WHERE sl.is_active = 1
      ORDER BY p.name, sl.license_name
    `);

    // Get installation history grouped by month
    const installationsResult = await pool.request()
      .input('months', sql.Int, parseInt(months) || 12)
      .query(`
        WITH MonthlyData AS (
          SELECT
            asi.license_id,
            YEAR(asi.created_at) as year,
            MONTH(asi.created_at) as month,
            COUNT(*) as installations_added
          FROM asset_software_installations asi
          WHERE asi.created_at >= DATEADD(month, -@months, GETUTCDATE())
          GROUP BY asi.license_id, YEAR(asi.created_at), MONTH(asi.created_at)
        ),
        MonthlyRemovals AS (
          SELECT
            asi.license_id,
            YEAR(asi.updated_at) as year,
            MONTH(asi.updated_at) as month,
            COUNT(*) as installations_removed
          FROM asset_software_installations asi
          WHERE asi.is_active = 0
            AND asi.updated_at >= DATEADD(month, -@months, GETUTCDATE())
          GROUP BY asi.license_id, YEAR(asi.updated_at), MONTH(asi.updated_at)
        )
        SELECT
          COALESCE(md.license_id, mr.license_id) as license_id,
          COALESCE(md.year, mr.year) as year,
          COALESCE(md.month, mr.month) as month,
          ISNULL(md.installations_added, 0) as installations_added,
          ISNULL(mr.installations_removed, 0) as installations_removed
        FROM MonthlyData md
        FULL OUTER JOIN MonthlyRemovals mr
          ON md.license_id = mr.license_id AND md.year = mr.year AND md.month = mr.month
        ORDER BY year DESC, month DESC
      `);

    // Get current allocation counts per license
    const currentAllocationsResult = await pool.request().query(`
      SELECT
        license_id,
        COUNT(*) as current_allocated
      FROM asset_software_installations
      WHERE is_active = 1
      GROUP BY license_id
    `);

    // Build current allocations map
    const currentAllocations = {};
    currentAllocationsResult.recordset.forEach(row => {
      currentAllocations[row.license_id] = row.current_allocated;
    });

    // Build monthly data map for each license
    const licenseMonthlyData = {};
    installationsResult.recordset.forEach(row => {
      if (!licenseMonthlyData[row.license_id]) {
        licenseMonthlyData[row.license_id] = {};
      }
      const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
      licenseMonthlyData[row.license_id][key] = {
        added: row.installations_added,
        removed: row.installations_removed
      };
    });

    // Generate period labels
    const periodLabels = [];
    const now = new Date();
    const monthsCount = parseInt(months) || 12;

    if (period === 'quarterly') {
      // Generate quarterly labels
      for (let i = Math.ceil(monthsCount / 3) - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - (i * 3), 1);
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        periodLabels.push({
          label: `Q${quarter} ${date.getFullYear()}`,
          year: date.getFullYear(),
          quarter: quarter,
          months: [
            `${date.getFullYear()}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}`,
            `${date.getFullYear()}-${String((quarter - 1) * 3 + 2).padStart(2, '0')}`,
            `${date.getFullYear()}-${String((quarter - 1) * 3 + 3).padStart(2, '0')}`
          ]
        });
      }
    } else {
      // Generate monthly labels
      for (let i = monthsCount - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        periodLabels.push({
          label: `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`,
          key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        });
      }
    }

    // Build analytics for each license
    const analytics = licensesResult.recordset.map(license => {
      const currentAlloc = currentAllocations[license.id] || 0;
      const monthlyData = licenseMonthlyData[license.id] || {};

      // Calculate peak usage for each period
      const periodData = periodLabels.map(periodInfo => {
        if (period === 'quarterly') {
          // Sum data across quarter months
          let totalAdded = 0;
          let totalRemoved = 0;
          periodInfo.months.forEach(monthKey => {
            if (monthlyData[monthKey]) {
              totalAdded += monthlyData[monthKey].added;
              totalRemoved += monthlyData[monthKey].removed;
            }
          });
          return {
            period: periodInfo.label,
            usage: currentAlloc // Peak is approximated from current allocation
          };
        } else {
          const data = monthlyData[periodInfo.key] || { added: 0, removed: 0 };
          return {
            period: periodInfo.label,
            added: data.added,
            removed: data.removed,
            usage: currentAlloc // Best approximation without full history
          };
        }
      });

      // Find peak usage across periods
      const peakUsage = Math.max(currentAlloc, ...periodData.map(p => p.usage || 0));

      return {
        license_id: license.id,
        license_name: license.license_name,
        product_name: license.product_name,
        product_model: license.product_model,
        oem_name: license.oem_name,
        license_type: license.license_type,
        purchased: license.purchased,
        current_allocated: currentAlloc,
        peak_usage: peakUsage,
        utilization_percent: license.purchased > 0
          ? Math.round((peakUsage / license.purchased) * 100)
          : 0,
        purchase_date: license.purchase_date,
        expiration_date: license.expiration_date,
        period_data: periodData
      };
    });

    // Calculate summary
    const summary = {
      total_licenses: analytics.length,
      total_purchased: analytics.reduce((sum, l) => sum + l.purchased, 0),
      total_peak_usage: analytics.reduce((sum, l) => sum + l.peak_usage, 0),
      total_current_allocated: analytics.reduce((sum, l) => sum + l.current_allocated, 0),
      over_utilized: analytics.filter(l => l.peak_usage > l.purchased).length,
      under_utilized: analytics.filter(l => l.utilization_percent < 50).length
    };

    sendSuccess(res, {
      period,
      periods: periodLabels.map(p => p.label),
      licenses: analytics,
      summary
    }, 'License usage analytics generated');
  })
);

/**
 * GET /licenses/expiration-alerts
 * Get items nearing expiration - warranty, EOL, EOS, license expiration
 * Query params: days = days threshold (default 90), type = 'all' | 'warranty' | 'eol' | 'eos' | 'license'
 */
router.get('/expiration-alerts',
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { days = 90, type = 'all' } = req.query;
    const daysThreshold = parseInt(days) || 90;
    const pool = await connectDB();

    const alerts = {
      warranty_expiring: [],
      eol_approaching: [],
      eos_approaching: [],
      license_expiring: [],
      support_ending: []
    };

    // Get assets with expiring warranty
    if (type === 'all' || type === 'warranty') {
      const warrantyResult = await pool.request()
        .input('days', sql.Int, daysThreshold)
        .query(`
          SELECT
            a.id as asset_id,
            a.asset_tag,
            a.serial_number,
            a.warranty_end_date,
            DATEDIFF(day, GETUTCDATE(), a.warranty_end_date) as days_remaining,
            p.name as product_name,
            p.model as product_model,
            o.name as oem_name,
            u.first_name + ' ' + u.last_name as assigned_to,
            l.name as location_name
          FROM assets a
          JOIN products p ON a.product_id = p.id
          LEFT JOIN oems o ON p.oem_id = o.id
          LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
          LEFT JOIN locations l ON u.location_id = l.id
          WHERE a.is_active = 1
            AND a.warranty_end_date IS NOT NULL
            AND a.warranty_end_date <= DATEADD(day, @days, GETUTCDATE())
            AND a.warranty_end_date >= GETUTCDATE()
          ORDER BY a.warranty_end_date ASC
        `);
      alerts.warranty_expiring = warrantyResult.recordset;
    }

    // Get assets approaching End of Life (EOL)
    if (type === 'all' || type === 'eol') {
      const eolResult = await pool.request()
        .input('days', sql.Int, daysThreshold)
        .query(`
          SELECT
            a.id as asset_id,
            a.asset_tag,
            a.serial_number,
            a.eol_date,
            DATEDIFF(day, GETUTCDATE(), a.eol_date) as days_remaining,
            p.name as product_name,
            p.model as product_model,
            o.name as oem_name,
            u.first_name + ' ' + u.last_name as assigned_to,
            l.name as location_name
          FROM assets a
          JOIN products p ON a.product_id = p.id
          LEFT JOIN oems o ON p.oem_id = o.id
          LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
          LEFT JOIN locations l ON u.location_id = l.id
          WHERE a.is_active = 1
            AND a.eol_date IS NOT NULL
            AND a.eol_date <= DATEADD(day, @days, GETUTCDATE())
            AND a.eol_date >= GETUTCDATE()
          ORDER BY a.eol_date ASC
        `);
      alerts.eol_approaching = eolResult.recordset;
    }

    // Get assets approaching End of Support (EOS/EOSL)
    if (type === 'all' || type === 'eos') {
      const eosResult = await pool.request()
        .input('days', sql.Int, daysThreshold)
        .query(`
          SELECT
            a.id as asset_id,
            a.asset_tag,
            a.serial_number,
            a.eos_date,
            DATEDIFF(day, GETUTCDATE(), a.eos_date) as days_remaining,
            p.name as product_name,
            p.model as product_model,
            o.name as oem_name,
            u.first_name + ' ' + u.last_name as assigned_to,
            l.name as location_name
          FROM assets a
          JOIN products p ON a.product_id = p.id
          LEFT JOIN oems o ON p.oem_id = o.id
          LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
          LEFT JOIN locations l ON u.location_id = l.id
          WHERE a.is_active = 1
            AND a.eos_date IS NOT NULL
            AND a.eos_date <= DATEADD(day, @days, GETUTCDATE())
            AND a.eos_date >= GETUTCDATE()
          ORDER BY a.eos_date ASC
        `);
      alerts.eos_approaching = eosResult.recordset;
    }

    // Get licenses expiring
    if (type === 'all' || type === 'license') {
      const licenseResult = await pool.request()
        .input('days', sql.Int, daysThreshold)
        .query(`
          SELECT
            sl.id as license_id,
            sl.license_name,
            sl.license_type,
            sl.total_licenses as purchased,
            sl.expiration_date,
            DATEDIFF(day, GETUTCDATE(), sl.expiration_date) as days_remaining,
            p.name as product_name,
            p.model as product_model,
            o.name as oem_name,
            v.name as vendor_name,
            COUNT(asi.id) as allocated
          FROM software_licenses sl
          JOIN products p ON sl.product_id = p.id
          LEFT JOIN oems o ON p.oem_id = o.id
          LEFT JOIN vendors v ON sl.vendor_id = v.id
          LEFT JOIN asset_software_installations asi ON asi.license_id = sl.id AND asi.is_active = 1
          WHERE sl.is_active = 1
            AND sl.expiration_date IS NOT NULL
            AND sl.expiration_date <= DATEADD(day, @days, GETUTCDATE())
            AND sl.expiration_date >= GETUTCDATE()
          GROUP BY
            sl.id, sl.license_name, sl.license_type, sl.total_licenses,
            sl.expiration_date, p.name, p.model, o.name, v.name
          ORDER BY sl.expiration_date ASC
        `);
      alerts.license_expiring = licenseResult.recordset;
    }

    // Get licenses with support ending
    if (type === 'all' || type === 'support') {
      const supportResult = await pool.request()
        .input('days', sql.Int, daysThreshold)
        .query(`
          SELECT
            sl.id as license_id,
            sl.license_name,
            sl.license_type,
            sl.total_licenses as purchased,
            sl.support_end_date,
            DATEDIFF(day, GETUTCDATE(), sl.support_end_date) as days_remaining,
            p.name as product_name,
            p.model as product_model,
            o.name as oem_name,
            v.name as vendor_name,
            COUNT(asi.id) as allocated
          FROM software_licenses sl
          JOIN products p ON sl.product_id = p.id
          LEFT JOIN oems o ON p.oem_id = o.id
          LEFT JOIN vendors v ON sl.vendor_id = v.id
          LEFT JOIN asset_software_installations asi ON asi.license_id = sl.id AND asi.is_active = 1
          WHERE sl.is_active = 1
            AND sl.support_end_date IS NOT NULL
            AND sl.support_end_date <= DATEADD(day, @days, GETUTCDATE())
            AND sl.support_end_date >= GETUTCDATE()
          GROUP BY
            sl.id, sl.license_name, sl.license_type, sl.total_licenses,
            sl.support_end_date, p.name, p.model, o.name, v.name
          ORDER BY sl.support_end_date ASC
        `);
      alerts.support_ending = supportResult.recordset;
    }

    // Calculate summary
    const summary = {
      warranty_count: alerts.warranty_expiring.length,
      eol_count: alerts.eol_approaching.length,
      eos_count: alerts.eos_approaching.length,
      license_count: alerts.license_expiring.length,
      support_count: alerts.support_ending.length,
      total_alerts: alerts.warranty_expiring.length + alerts.eol_approaching.length +
                    alerts.eos_approaching.length + alerts.license_expiring.length +
                    alerts.support_ending.length,
      critical_30_days: {
        warranty: alerts.warranty_expiring.filter(a => a.days_remaining <= 30).length,
        eol: alerts.eol_approaching.filter(a => a.days_remaining <= 30).length,
        eos: alerts.eos_approaching.filter(a => a.days_remaining <= 30).length,
        license: alerts.license_expiring.filter(a => a.days_remaining <= 30).length,
        support: alerts.support_ending.filter(a => a.days_remaining <= 30).length
      }
    };

    sendSuccess(res, {
      days_threshold: daysThreshold,
      alerts,
      summary
    }, 'Expiration alerts generated');
  })
);

/**
 * GET /licenses/for-product/:productId
 * Get licenses available for a specific software product
 * Only returns licenses that are ready for allocation:
 * - For per_user/per_device: must have all license keys added
 * - For site/volume/concurrent: must have master key or all keys added
 *
 * Query params:
 * - include_license_id: Include a specific license even if fully allocated (for editing existing installations)
 */
router.get('/for-product/:productId',
  validateUUID('productId'),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { include_license_id } = req.query;
    const pool = await connectDB();

    // Build query with optional include for specific license
    let havingClause = 'sl.total_licenses - COUNT(asi.id) > 0';
    if (include_license_id) {
      havingClause = `(sl.total_licenses - COUNT(asi.id) > 0 OR sl.id = @include_license_id)`;
    }

    const request = pool.request()
      .input('product_id', sql.UniqueIdentifier, productId);

    if (include_license_id) {
      request.input('include_license_id', sql.UniqueIdentifier, include_license_id);
    }

    const result = await request.query(`
        SELECT
          sl.id,
          sl.license_name,
          sl.license_type,
          sl.total_licenses,
          sl.license_key,
          sl.expiration_date,
          COUNT(asi.id) as allocated_licenses,
          sl.total_licenses - COUNT(asi.id) as available_licenses,
          (SELECT COUNT(*) FROM software_license_keys WHERE license_id = sl.id AND is_active = 1) as keys_count
        FROM software_licenses sl
        LEFT JOIN asset_software_installations asi ON asi.license_id = sl.id AND asi.is_active = 1
        WHERE sl.product_id = @product_id AND sl.is_active = 1
        GROUP BY sl.id, sl.license_name, sl.license_type, sl.total_licenses, sl.license_key, sl.expiration_date
        HAVING ${havingClause}
        ORDER BY sl.license_name
      `);

    // Filter licenses based on key availability
    // - For site/volume/concurrent: either master key exists OR all individual keys are added
    // - For per_user/per_device: all individual keys must be added
    const filteredLicenses = result.recordset.filter(license => {
      const hasMasterKey = license.license_key && license.license_key.trim().length > 0;
      const hasAllKeys = license.keys_count >= license.total_licenses;

      // Always include the specifically requested license (for editing)
      if (include_license_id && license.id === include_license_id) {
        return true;
      }

      if (['site', 'volume', 'concurrent'].includes(license.license_type)) {
        // Site/Volume/Concurrent can use master key OR individual keys
        return hasMasterKey || hasAllKeys;
      } else {
        // Per user/Per device must have all individual keys added
        return hasAllKeys;
      }
    });

    sendSuccess(res, filteredLicenses, 'Available licenses retrieved');
  })
);

// =====================================================
// LICENSE KEYS MANAGEMENT
// =====================================================

/**
 * GET /licenses/:licenseId/keys
 * Get all license keys for a specific license
 */
router.get('/:licenseId/keys',
  validateUUID('licenseId'),
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { licenseId } = req.params;
    const pool = await connectDB();

    // Verify license exists
    const licenseCheck = await pool.request()
      .input('license_id', sql.UniqueIdentifier, licenseId)
      .query('SELECT id, license_name FROM software_licenses WHERE id = @license_id');

    if (licenseCheck.recordset.length === 0) {
      return sendNotFound(res, 'License not found');
    }

    const result = await pool.request()
      .input('license_id', sql.UniqueIdentifier, licenseId)
      .query(`
        SELECT
          lk.id,
          lk.license_id,
          lk.license_key,
          lk.is_allocated,
          lk.allocated_to_asset_id,
          lk.allocated_at,
          lk.notes,
          lk.is_active,
          lk.created_at,
          a.asset_tag,
          a.serial_number,
          p.name as asset_product_name,
          u.first_name + ' ' + u.last_name as assigned_to_name
        FROM software_license_keys lk
        LEFT JOIN assets a ON lk.allocated_to_asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
        WHERE lk.license_id = @license_id AND lk.is_active = 1
        ORDER BY lk.is_allocated ASC, lk.created_at ASC
      `);

    // Get summary counts
    const summary = {
      total: result.recordset.length,
      allocated: result.recordset.filter(k => k.is_allocated).length,
      available: result.recordset.filter(k => !k.is_allocated).length
    };

    sendSuccess(res, { keys: result.recordset, summary }, 'License keys retrieved successfully');
  })
);

/**
 * POST /licenses/:licenseId/keys
 * Add license keys to a license (single or bulk)
 */
router.post('/:licenseId/keys',
  validateUUID('licenseId'),
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { licenseId } = req.params;
    const { license_keys } = req.body; // Array of license key strings or single key

    if (!license_keys || (Array.isArray(license_keys) && license_keys.length === 0)) {
      return sendError(res, 'At least one license key is required', 400);
    }

    const pool = await connectDB();

    // Verify license exists
    const licenseCheck = await pool.request()
      .input('license_id', sql.UniqueIdentifier, licenseId)
      .query('SELECT id, license_name, total_licenses FROM software_licenses WHERE id = @license_id');

    if (licenseCheck.recordset.length === 0) {
      return sendNotFound(res, 'License not found');
    }

    const license = licenseCheck.recordset[0];

    // Get current key count
    const keyCountResult = await pool.request()
      .input('license_id', sql.UniqueIdentifier, licenseId)
      .query('SELECT COUNT(*) as count FROM software_license_keys WHERE license_id = @license_id AND is_active = 1');

    const currentKeyCount = keyCountResult.recordset[0].count;
    const keysToAdd = Array.isArray(license_keys) ? license_keys : [license_keys];

    // Check if adding these keys would exceed total_licenses
    if (currentKeyCount + keysToAdd.length > license.total_licenses) {
      return sendError(res, `Cannot add ${keysToAdd.length} keys. Would exceed total licenses (${license.total_licenses}). Currently have ${currentKeyCount} keys.`, 400);
    }

    // Insert license keys
    const addedKeys = [];
    const errors = [];

    for (const keyValue of keysToAdd) {
      if (!keyValue || !keyValue.trim()) {
        errors.push({ key: keyValue, error: 'Empty key value' });
        continue;
      }

      try {
        const keyId = uuidv4();
        await pool.request()
          .input('id', sql.UniqueIdentifier, keyId)
          .input('license_id', sql.UniqueIdentifier, licenseId)
          .input('license_key', sql.NVarChar(500), keyValue.trim())
          .query(`
            INSERT INTO software_license_keys (id, license_id, license_key, is_allocated, is_active, created_at, updated_at)
            VALUES (@id, @license_id, @license_key, 0, 1, GETUTCDATE(), GETUTCDATE())
          `);

        addedKeys.push({ id: keyId, license_key: keyValue.trim() });
      } catch (error) {
        errors.push({ key: keyValue, error: error.message });
      }
    }

    sendCreated(res, {
      added: addedKeys.length,
      failed: errors.length,
      keys: addedKeys,
      errors: errors.length > 0 ? errors : undefined
    }, `Added ${addedKeys.length} license key(s)`);
  })
);

/**
 * DELETE /licenses/:licenseId/keys/:keyId
 * Remove a license key (soft delete)
 */
router.delete('/:licenseId/keys/:keyId',
  validateUUID('licenseId'),
  validateUUID('keyId'),
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { licenseId, keyId } = req.params;
    const pool = await connectDB();

    // Check if key exists and belongs to this license
    const keyCheck = await pool.request()
      .input('key_id', sql.UniqueIdentifier, keyId)
      .input('license_id', sql.UniqueIdentifier, licenseId)
      .query('SELECT id, is_allocated FROM software_license_keys WHERE id = @key_id AND license_id = @license_id AND is_active = 1');

    if (keyCheck.recordset.length === 0) {
      return sendNotFound(res, 'License key not found');
    }

    if (keyCheck.recordset[0].is_allocated) {
      return sendConflict(res, 'Cannot delete an allocated license key. Deallocate it first.');
    }

    // Soft delete
    await pool.request()
      .input('key_id', sql.UniqueIdentifier, keyId)
      .query('UPDATE software_license_keys SET is_active = 0, updated_at = GETUTCDATE() WHERE id = @key_id');

    sendSuccess(res, null, 'License key deleted successfully');
  })
);

/**
 * GET /licenses/:licenseId/keys/available
 * Get next available (unallocated) license key for a license
 */
router.get('/:licenseId/keys/available',
  validateUUID('licenseId'),
  asyncHandler(async (req, res) => {
    const { licenseId } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('license_id', sql.UniqueIdentifier, licenseId)
      .query(`
        SELECT TOP 1 id, license_key
        FROM software_license_keys
        WHERE license_id = @license_id AND is_allocated = 0 AND is_active = 1
        ORDER BY created_at ASC
      `);

    if (result.recordset.length === 0) {
      return sendSuccess(res, null, 'No available license keys');
    }

    sendSuccess(res, result.recordset[0], 'Available license key retrieved');
  })
);

// =====================================================
// LICENSES CRUD
// =====================================================

/**
 * GET /licenses
 * Get all software licenses with pagination and filters
 */
router.get('/',
  validatePagination,
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head']),
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, license_type, product_id, vendor_id, status, expiring } = req.query;

    const pool = await connectDB();

    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (sl.license_name LIKE @search OR p.name LIKE @search OR sl.license_key LIKE @search)';
      params.push({ name: 'search', type: sql.NVarChar, value: `%${search}%` });
    }

    if (license_type) {
      whereClause += ' AND sl.license_type = @license_type';
      params.push({ name: 'license_type', type: sql.VarChar(50), value: license_type });
    }

    if (product_id) {
      whereClause += ' AND sl.product_id = @product_id';
      params.push({ name: 'product_id', type: sql.UniqueIdentifier, value: product_id });
    }

    if (vendor_id) {
      whereClause += ' AND sl.vendor_id = @vendor_id';
      params.push({ name: 'vendor_id', type: sql.UniqueIdentifier, value: vendor_id });
    }

    if (status) {
      whereClause += ' AND sl.is_active = @status';
      params.push({ name: 'status', type: sql.Bit, value: status === 'active' });
    }

    if (expiring === 'true') {
      whereClause += ' AND sl.expiration_date IS NOT NULL AND sl.expiration_date <= DATEADD(day, 30, GETUTCDATE())';
    }

    // Get total count
    const countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM software_licenses sl
      JOIN products p ON sl.product_id = p.id
      WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Get paginated results
    const dataRequest = pool.request();
    params.forEach(param => dataRequest.input(param.name, param.type, param.value));
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const validSortFields = ['license_name', 'product_name', 'license_type', 'total_licenses', 'expiration_date', 'created_at'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const result = await dataRequest.query(`
      SELECT
        sl.*,
        p.name as product_name,
        p.model as product_model,
        o.name as oem_name,
        v.name as vendor_name,
        u.first_name + ' ' + u.last_name as created_by_name,
        COUNT(asi.id) as allocated_count,
        sl.total_licenses - COUNT(asi.id) as available_count,
        (SELECT COUNT(*) FROM software_license_keys WHERE license_id = sl.id AND is_active = 1) as keys_count
      FROM software_licenses sl
      JOIN products p ON sl.product_id = p.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN vendors v ON sl.vendor_id = v.id
      LEFT JOIN USER_MASTER u ON sl.created_by = u.user_id
      LEFT JOIN asset_software_installations asi ON asi.license_id = sl.id AND asi.is_active = 1
      WHERE ${whereClause}
      GROUP BY
        sl.id, sl.product_id, sl.license_name, sl.license_type, sl.total_licenses,
        sl.license_key, sl.vendor_id, sl.purchase_date, sl.expiration_date,
        sl.purchase_cost, sl.support_end_date, sl.notes, sl.is_active,
        sl.created_at, sl.updated_at, sl.created_by,
        p.name, p.model, o.name, v.name, u.first_name, u.last_name
      ORDER BY ${safeSortBy === 'product_name' ? 'p.name' : 'sl.' + safeSortBy} ${safeSortOrder}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const pagination = getPaginationInfo(page, limit, total);

    sendSuccess(res, {
      licenses: result.recordset,
      pagination
    }, 'Licenses retrieved successfully');
  })
);

/**
 * GET /licenses/:id
 * Get single license with installation details
 */
router.get('/:id',
  validateUUID('id'),
  requireRole(['admin', 'superadmin', 'coordinator', 'it_head', 'engineer']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    // Get license details
    const licenseResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          sl.*,
          p.name as product_name,
          p.model as product_model,
          o.name as oem_name,
          v.name as vendor_name,
          u.first_name + ' ' + u.last_name as created_by_name
        FROM software_licenses sl
        JOIN products p ON sl.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN vendors v ON sl.vendor_id = v.id
        LEFT JOIN USER_MASTER u ON sl.created_by = u.user_id
        WHERE sl.id = @id
      `);

    if (licenseResult.recordset.length === 0) {
      return sendNotFound(res, 'License not found');
    }

    // Get installations using this license
    const installationsResult = await pool.request()
      .input('license_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          asi.id,
          asi.installation_date as installed_at,
          a.id as asset_id,
          a.asset_tag,
          a.serial_number,
          p.name as asset_product_name,
          assigned_user.first_name + ' ' + assigned_user.last_name as assigned_to_name,
          l.name as location_name
        FROM asset_software_installations asi
        JOIN assets a ON asi.asset_id = a.id
        JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER assigned_user ON a.assigned_to = assigned_user.user_id
        LEFT JOIN locations l ON assigned_user.location_id = l.id
        WHERE asi.license_id = @license_id AND asi.is_active = 1
        ORDER BY asi.installation_date DESC
      `);

    // Get license keys statistics
    const keysResult = await pool.request()
      .input('license_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          COUNT(*) as total_keys,
          SUM(CASE WHEN is_allocated = 1 THEN 1 ELSE 0 END) as allocated_keys,
          SUM(CASE WHEN is_allocated = 0 THEN 1 ELSE 0 END) as available_keys
        FROM software_license_keys
        WHERE license_id = @license_id AND is_active = 1
      `);

    const license = licenseResult.recordset[0];
    license.installations = installationsResult.recordset;
    license.allocated_count = installationsResult.recordset.length;
    license.available_count = license.total_licenses - license.allocated_count;

    // Add license keys info
    const keysStats = keysResult.recordset[0];
    license.keys_stats = {
      total_keys: keysStats.total_keys || 0,
      allocated_keys: keysStats.allocated_keys || 0,
      available_keys: keysStats.available_keys || 0,
      keys_missing: license.total_licenses - (keysStats.total_keys || 0)
    };

    sendSuccess(res, license, 'License retrieved successfully');
  })
);

/**
 * POST /licenses/bulk-upload
 * Bulk upload licenses with their keys
 * Expected format: Array of license objects with license_keys array
 */
router.post('/bulk-upload',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { licenses } = req.body;

    if (!licenses || !Array.isArray(licenses) || licenses.length === 0) {
      return sendError(res, 'Licenses array is required', 400);
    }

    const pool = await connectDB();
    const results = {
      success: [],
      errors: []
    };

    for (let index = 0; index < licenses.length; index++) {
      const licenseData = licenses[index];
      const rowNum = index + 1;

      try {
        const {
          product_id,
          product_name,  // For lookup if product_id not provided
          license_name,
          license_type = 'per_device',
          total_licenses,
          license_key,  // Master key for site/volume/concurrent
          license_keys = [], // Array of individual keys for per_user/per_device
          vendor_id,
          vendor_name,  // For lookup if vendor_id not provided
          purchase_date,
          expiration_date,
          purchase_cost,
          support_end_date,
          notes
        } = licenseData;

        // Validate required fields
        if (!license_name || !license_name.trim()) {
          results.errors.push({ row: rowNum, error: 'License name is required', data: licenseData });
          continue;
        }

        if (total_licenses === undefined || total_licenses < 0) {
          results.errors.push({ row: rowNum, error: 'Total licenses must be a non-negative number', data: licenseData });
          continue;
        }

        const validLicenseTypes = ['per_user', 'per_device', 'concurrent', 'site', 'volume'];
        if (!validLicenseTypes.includes(license_type)) {
          results.errors.push({ row: rowNum, error: `Invalid license type: ${license_type}`, data: licenseData });
          continue;
        }

        // Resolve product_id from product_name (and optionally model) if not provided
        // Supports formats: "Product Name" or "Product Name - Model"
        let resolvedProductId = product_id;
        if (!resolvedProductId && product_name) {
          const trimmedProductName = product_name.trim();

          // Check if product_name contains " - " which indicates "Name - Model" format
          let searchName = trimmedProductName;
          let searchModel = null;

          if (trimmedProductName.includes(' - ')) {
            const parts = trimmedProductName.split(' - ');
            searchName = parts[0].trim();
            searchModel = parts.slice(1).join(' - ').trim(); // Handle cases where model itself contains " - "
          }

          let productResult;
          if (searchModel) {
            // Search by both name and model
            productResult = await pool.request()
              .input('product_name', sql.NVarChar(200), searchName)
              .input('product_model', sql.NVarChar(200), searchModel)
              .query(`
                SELECT TOP 1 p.id
                FROM products p
                JOIN categories c ON p.category_id = c.id
                WHERE p.name = @product_name
                  AND p.model = @product_model
                  AND LOWER(c.name) = 'software'
              `);
          } else {
            // Search by name only - but warn if multiple matches exist
            productResult = await pool.request()
              .input('product_name', sql.NVarChar(200), searchName)
              .query(`
                SELECT p.id, p.model
                FROM products p
                JOIN categories c ON p.category_id = c.id
                WHERE p.name = @product_name AND LOWER(c.name) = 'software'
              `);

            // If multiple products with same name, require model specification
            if (productResult.recordset.length > 1) {
              const models = productResult.recordset.map(p => p.model || '(no model)').join(', ');
              results.errors.push({
                row: rowNum,
                error: `Multiple products found with name "${searchName}". Please specify model using format "Product Name - Model". Available models: ${models}`,
                data: licenseData
              });
              continue;
            }
          }

          if (productResult.recordset.length > 0) {
            resolvedProductId = productResult.recordset[0].id;
          } else {
            const searchDesc = searchModel ? `${searchName} - ${searchModel}` : searchName;
            results.errors.push({ row: rowNum, error: `Software product not found: ${searchDesc}`, data: licenseData });
            continue;
          }
        }

        if (!resolvedProductId) {
          results.errors.push({ row: rowNum, error: 'Product ID or Product Name is required', data: licenseData });
          continue;
        }

        // Verify product exists
        const productCheck = await pool.request()
          .input('product_id', sql.UniqueIdentifier, resolvedProductId)
          .query('SELECT id FROM products WHERE id = @product_id');

        if (productCheck.recordset.length === 0) {
          results.errors.push({ row: rowNum, error: 'Product not found', data: licenseData });
          continue;
        }

        // Resolve vendor_id from vendor_name if not provided
        let resolvedVendorId = vendor_id;
        if (!resolvedVendorId && vendor_name) {
          const vendorResult = await pool.request()
            .input('vendor_name', sql.NVarChar(200), vendor_name.trim())
            .query('SELECT TOP 1 id FROM vendors WHERE name = @vendor_name');

          if (vendorResult.recordset.length > 0) {
            resolvedVendorId = vendorResult.recordset[0].id;
          }
        }

        // Validate license keys for per_user/per_device types
        const isMasterKeyType = ['site', 'volume', 'concurrent'].includes(license_type);
        const keysArray = Array.isArray(license_keys)
          ? license_keys.map(k => (typeof k === 'string' ? k.trim() : '')).filter(k => k.length > 0)
          : typeof license_keys === 'string'
            ? license_keys.split(/[,;\n]+/).map(k => k.trim()).filter(k => k.length > 0)
            : [];

        if (!isMasterKeyType) {
          // For per_user/per_device, must have all license keys
          if (keysArray.length !== total_licenses) {
            results.errors.push({
              row: rowNum,
              error: `Must provide exactly ${total_licenses} license key(s), got ${keysArray.length}`,
              data: licenseData
            });
            continue;
          }
        } else {
          // For site/volume/concurrent, must have master key
          if (!license_key || !license_key.trim()) {
            results.errors.push({
              row: rowNum,
              error: 'Master license key is required for site/volume/concurrent license types',
              data: licenseData
            });
            continue;
          }
        }

        // Check for duplicate license name for the same product
        const duplicateResult = await pool.request()
          .input('product_id', sql.UniqueIdentifier, resolvedProductId)
          .input('license_name', sql.NVarChar(200), license_name.trim())
          .query(`
            SELECT id FROM software_licenses
            WHERE product_id = @product_id AND LOWER(license_name) = LOWER(@license_name)
          `);

        if (duplicateResult.recordset.length > 0) {
          results.errors.push({ row: rowNum, error: 'Duplicate license name for this product', data: licenseData });
          continue;
        }

        // Create the license
        const licenseId = uuidv4();
        await pool.request()
          .input('id', sql.UniqueIdentifier, licenseId)
          .input('product_id', sql.UniqueIdentifier, resolvedProductId)
          .input('license_name', sql.NVarChar(200), license_name.trim())
          .input('license_type', sql.VarChar(50), license_type)
          .input('total_licenses', sql.Int, total_licenses)
          .input('license_key', sql.NVarChar(500), license_key || null)
          .input('vendor_id', sql.UniqueIdentifier, resolvedVendorId || null)
          .input('purchase_date', sql.Date, purchase_date || null)
          .input('expiration_date', sql.Date, expiration_date || null)
          .input('purchase_cost', sql.Decimal(15, 2), purchase_cost || null)
          .input('support_end_date', sql.Date, support_end_date || null)
          .input('notes', sql.NVarChar(sql.MAX), notes || null)
          .input('created_by', sql.UniqueIdentifier, req.user.id)
          .query(`
            INSERT INTO software_licenses
            (id, product_id, license_name, license_type, total_licenses, license_key,
             vendor_id, purchase_date, expiration_date, purchase_cost, support_end_date,
             notes, created_by, created_at, updated_at)
            VALUES
            (@id, @product_id, @license_name, @license_type, @total_licenses, @license_key,
             @vendor_id, @purchase_date, @expiration_date, @purchase_cost, @support_end_date,
             @notes, @created_by, GETUTCDATE(), GETUTCDATE())
          `);

        // Add individual license keys for per_user/per_device
        if (!isMasterKeyType && keysArray.length > 0) {
          for (const keyValue of keysArray) {
            const keyId = uuidv4();
            await pool.request()
              .input('id', sql.UniqueIdentifier, keyId)
              .input('license_id', sql.UniqueIdentifier, licenseId)
              .input('license_key', sql.NVarChar(500), keyValue)
              .query(`
                INSERT INTO software_license_keys (id, license_id, license_key, is_allocated, is_active, created_at, updated_at)
                VALUES (@id, @license_id, @license_key, 0, 1, GETUTCDATE(), GETUTCDATE())
              `);
          }
        }

        results.success.push({
          row: rowNum,
          license_id: licenseId,
          license_name: license_name.trim(),
          keys_added: !isMasterKeyType ? keysArray.length : 0
        });

      } catch (error) {
        results.errors.push({ row: rowNum, error: error.message, data: licenseData });
      }
    }

    const message = `Bulk upload completed: ${results.success.length} created, ${results.errors.length} failed`;
    sendSuccess(res, results, message);
  })
);

/**
 * GET /licenses/bulk-upload/template
 * Get template/schema for bulk upload
 */
router.get('/bulk-upload/template',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const template = {
      description: 'Template for bulk uploading software licenses with their keys',
      format: 'JSON array or CSV',
      fields: [
        { name: 'product_name', required: true, description: 'Name of the software product (must exist in system)', example: 'Microsoft Office 365' },
        { name: 'license_name', required: true, description: 'Name/identifier for this license', example: 'Office 365 Enterprise E3 - Batch 1' },
        { name: 'license_type', required: true, description: 'Type of license', options: ['per_user', 'per_device', 'concurrent', 'site', 'volume'], example: 'per_device' },
        { name: 'total_licenses', required: true, description: 'Number of licenses purchased', example: 10 },
        { name: 'license_key', required: 'For site/volume/concurrent only', description: 'Master license key (for site/volume/concurrent types)', example: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' },
        { name: 'license_keys', required: 'For per_user/per_device only', description: 'Array of individual license keys (must match total_licenses count)', example: ['KEY1-XXXXX', 'KEY2-XXXXX'] },
        { name: 'vendor_name', required: false, description: 'Vendor/supplier name (must exist in system)', example: 'Microsoft' },
        { name: 'purchase_date', required: false, description: 'Date of purchase (YYYY-MM-DD)', example: '2024-01-15' },
        { name: 'expiration_date', required: false, description: 'License expiration date (YYYY-MM-DD)', example: '2025-01-15' },
        { name: 'purchase_cost', required: false, description: 'Total purchase cost in INR', example: 50000 },
        { name: 'support_end_date', required: false, description: 'Support end date (YYYY-MM-DD)', example: '2025-01-15' },
        { name: 'notes', required: false, description: 'Additional notes', example: 'Annual subscription' }
      ],
      example_per_device: {
        product_name: 'Microsoft Office 365',
        license_name: 'Office 365 Enterprise E3 - Batch 1',
        license_type: 'per_device',
        total_licenses: 3,
        license_keys: ['KEY1-XXXXX-XXXXX', 'KEY2-XXXXX-XXXXX', 'KEY3-XXXXX-XXXXX'],
        vendor_name: 'Microsoft',
        purchase_date: '2024-01-15',
        expiration_date: '2025-01-15',
        purchase_cost: 50000,
        notes: 'Annual subscription'
      },
      example_site_license: {
        product_name: 'Adobe Creative Cloud',
        license_name: 'Adobe CC Site License 2024',
        license_type: 'site',
        total_licenses: 100,
        license_key: 'MASTER-KEY-XXXXX-XXXXX-XXXXX',
        vendor_name: 'Adobe',
        purchase_date: '2024-01-01',
        expiration_date: '2024-12-31',
        purchase_cost: 500000,
        notes: 'Site-wide license'
      }
    };

    sendSuccess(res, template, 'Bulk upload template retrieved');
  })
);

/**
 * POST /licenses
 * Create new software license
 */
router.post('/',
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const {
      product_id,
      license_name,
      license_type = 'per_device',
      total_licenses,
      license_key,
      vendor_id,
      purchase_date,
      expiration_date,
      purchase_cost,
      support_end_date,
      notes
    } = req.body;

    // Validate required fields
    if (!product_id) {
      return sendError(res, 'Product ID is required', 400);
    }
    if (!license_name || !license_name.trim()) {
      return sendError(res, 'License name is required', 400);
    }
    if (total_licenses === undefined || total_licenses < 0) {
      return sendError(res, 'Total licenses must be a non-negative number', 400);
    }

    const validLicenseTypes = ['per_user', 'per_device', 'concurrent', 'site', 'volume'];
    if (!validLicenseTypes.includes(license_type)) {
      return sendError(res, `Invalid license type. Must be one of: ${validLicenseTypes.join(', ')}`, 400);
    }

    const pool = await connectDB();

    // Verify product exists and is a software category
    const productResult = await pool.request()
      .input('product_id', sql.UniqueIdentifier, product_id)
      .query(`
        SELECT p.id, p.name, c.name as category_name
        FROM products p
        JOIN categories c ON p.category_id = c.id
        WHERE p.id = @product_id
      `);

    if (productResult.recordset.length === 0) {
      return sendNotFound(res, 'Product not found');
    }

    // Check for duplicate license name for the same product
    const duplicateResult = await pool.request()
      .input('product_id', sql.UniqueIdentifier, product_id)
      .input('license_name', sql.NVarChar(200), license_name.trim())
      .query(`
        SELECT id FROM software_licenses
        WHERE product_id = @product_id AND LOWER(license_name) = LOWER(@license_name)
      `);

    if (duplicateResult.recordset.length > 0) {
      return sendConflict(res, 'A license with this name already exists for this product');
    }

    const licenseId = uuidv4();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, licenseId)
      .input('product_id', sql.UniqueIdentifier, product_id)
      .input('license_name', sql.NVarChar(200), license_name.trim())
      .input('license_type', sql.VarChar(50), license_type)
      .input('total_licenses', sql.Int, total_licenses)
      .input('license_key', sql.NVarChar(500), license_key || null)
      .input('vendor_id', sql.UniqueIdentifier, vendor_id || null)
      .input('purchase_date', sql.Date, purchase_date || null)
      .input('expiration_date', sql.Date, expiration_date || null)
      .input('purchase_cost', sql.Decimal(15, 2), purchase_cost || null)
      .input('support_end_date', sql.Date, support_end_date || null)
      .input('notes', sql.NVarChar(sql.MAX), notes || null)
      .input('created_by', sql.UniqueIdentifier, req.user.id)
      .query(`
        INSERT INTO software_licenses
        (id, product_id, license_name, license_type, total_licenses, license_key,
         vendor_id, purchase_date, expiration_date, purchase_cost, support_end_date,
         notes, created_by, created_at, updated_at)
        VALUES
        (@id, @product_id, @license_name, @license_type, @total_licenses, @license_key,
         @vendor_id, @purchase_date, @expiration_date, @purchase_cost, @support_end_date,
         @notes, @created_by, GETUTCDATE(), GETUTCDATE());

        SELECT sl.*, p.name as product_name
        FROM software_licenses sl
        JOIN products p ON sl.product_id = p.id
        WHERE sl.id = @id;
      `);

    sendCreated(res, result.recordset[0], 'License created successfully');
  })
);

/**
 * PUT /licenses/:id
 * Update software license
 */
router.put('/:id',
  validateUUID('id'),
  requireRole(['admin', 'superadmin', 'coordinator']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      license_name,
      license_type,
      total_licenses,
      license_key,
      vendor_id,
      purchase_date,
      expiration_date,
      purchase_cost,
      support_end_date,
      notes,
      is_active
    } = req.body;

    const pool = await connectDB();

    // Check if license exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, product_id, license_name FROM software_licenses WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'License not found');
    }

    const existing = existingResult.recordset[0];

    // Check for name conflict if name is being changed
    if (license_name && license_name.trim() !== existing.license_name) {
      const conflictResult = await pool.request()
        .input('product_id', sql.UniqueIdentifier, existing.product_id)
        .input('license_name', sql.NVarChar(200), license_name.trim())
        .input('id', sql.UniqueIdentifier, id)
        .query(`
          SELECT id FROM software_licenses
          WHERE product_id = @product_id AND LOWER(license_name) = LOWER(@license_name) AND id != @id
        `);

      if (conflictResult.recordset.length > 0) {
        return sendConflict(res, 'A license with this name already exists for this product');
      }
    }

    // Validate license type if provided
    if (license_type) {
      const validLicenseTypes = ['per_user', 'per_device', 'concurrent', 'site', 'volume'];
      if (!validLicenseTypes.includes(license_type)) {
        return sendError(res, `Invalid license type. Must be one of: ${validLicenseTypes.join(', ')}`, 400);
      }
    }

    // Build update query
    const updateFields = [];
    const updateRequest = pool.request().input('id', sql.UniqueIdentifier, id);

    if (license_name !== undefined) {
      updateFields.push('license_name = @license_name');
      updateRequest.input('license_name', sql.NVarChar(200), license_name.trim());
    }
    if (license_type !== undefined) {
      updateFields.push('license_type = @license_type');
      updateRequest.input('license_type', sql.VarChar(50), license_type);
    }
    if (total_licenses !== undefined) {
      updateFields.push('total_licenses = @total_licenses');
      updateRequest.input('total_licenses', sql.Int, total_licenses);
    }
    if (license_key !== undefined) {
      updateFields.push('license_key = @license_key');
      updateRequest.input('license_key', sql.NVarChar(500), license_key || null);
    }
    if (vendor_id !== undefined) {
      updateFields.push('vendor_id = @vendor_id');
      updateRequest.input('vendor_id', sql.UniqueIdentifier, vendor_id || null);
    }
    if (purchase_date !== undefined) {
      updateFields.push('purchase_date = @purchase_date');
      updateRequest.input('purchase_date', sql.Date, purchase_date || null);
    }
    if (expiration_date !== undefined) {
      updateFields.push('expiration_date = @expiration_date');
      updateRequest.input('expiration_date', sql.Date, expiration_date || null);
    }
    if (purchase_cost !== undefined) {
      updateFields.push('purchase_cost = @purchase_cost');
      updateRequest.input('purchase_cost', sql.Decimal(15, 2), purchase_cost || null);
    }
    if (support_end_date !== undefined) {
      updateFields.push('support_end_date = @support_end_date');
      updateRequest.input('support_end_date', sql.Date, support_end_date || null);
    }
    if (notes !== undefined) {
      updateFields.push('notes = @notes');
      updateRequest.input('notes', sql.NVarChar(sql.MAX), notes || null);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = @is_active');
      updateRequest.input('is_active', sql.Bit, is_active);
    }

    if (updateFields.length === 0) {
      return sendError(res, 'No fields to update', 400);
    }

    updateFields.push('updated_at = GETUTCDATE()');

    const result = await updateRequest.query(`
      UPDATE software_licenses
      SET ${updateFields.join(', ')}
      WHERE id = @id;

      SELECT sl.*, p.name as product_name
      FROM software_licenses sl
      JOIN products p ON sl.product_id = p.id
      WHERE sl.id = @id;
    `);

    sendSuccess(res, result.recordset[0], 'License updated successfully');
  })
);

/**
 * DELETE /licenses/:id
 * Delete (deactivate) software license
 */
router.delete('/:id',
  validateUUID('id'),
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    // Check if license exists
    const existingResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM software_licenses WHERE id = @id');

    if (existingResult.recordset.length === 0) {
      return sendNotFound(res, 'License not found');
    }

    // Check if license is in use
    const inUseResult = await pool.request()
      .input('license_id', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) as count FROM asset_software_installations WHERE license_id = @license_id');

    if (inUseResult.recordset[0].count > 0) {
      // Soft delete - deactivate instead
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`
          UPDATE software_licenses
          SET is_active = 0, updated_at = GETUTCDATE()
          WHERE id = @id
        `);

      return sendSuccess(res, null, 'License deactivated (has active installations)');
    }

    // Hard delete if not in use
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM software_licenses WHERE id = @id');

    sendSuccess(res, null, 'License deleted successfully');
  })
);

module.exports = router;
