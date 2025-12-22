/**
 * ASSET FAULT FLAGS MODEL
 * Handles problematic asset/model tracking
 */

const { connectDB, sql } = require('../config/database');

class AssetFaultFlagsModel {
  /**
   * Get all active fault flags
   */
  static async getActiveFlags(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE f.is_active = 1 AND f.is_resolved = 0';
      const params = {};

      if (filters.flag_type) {
        whereClause += ' AND f.flag_type = @flagType';
        params.flagType = filters.flag_type;
      }

      if (filters.severity) {
        whereClause += ' AND f.severity = @severity';
        params.severity = filters.severity;
      }

      const query = `
        SELECT
          f.*,
          f.flag_reason AS reason,
          -- Asset info
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          a.parent_asset_id,
          -- Parent asset info (if component)
          pa.asset_tag AS parent_asset_tag,
          -- Product info
          p.name AS product_name,
          p.model AS product_model,
          -- OEM info
          o.name AS oem_name,
          -- Fault type
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          -- Previous flag info (for recurring issues)
          pf.resolved_at AS previous_resolved_at,
          pf.resolution_action AS previous_resolution_action,
          -- Component repairs count (for parent assets)
          (SELECT COUNT(*) FROM ASSET_REPAIR_HISTORY rh WHERE rh.parent_asset_id = a.id) AS component_repairs_count,
          -- Total repairs including components
          (SELECT COUNT(*) FROM ASSET_REPAIR_HISTORY rh WHERE rh.asset_id = a.id OR rh.parent_asset_id = a.id) AS total_repairs_with_components
        FROM ASSET_FAULT_FLAGS f
        LEFT JOIN assets a ON f.asset_id = a.id
        LEFT JOIN assets pa ON a.parent_asset_id = pa.id
        LEFT JOIN products p ON f.product_id = p.id OR a.product_id = p.id
        LEFT JOIN oems o ON f.oem_id = o.id OR p.oem_id = o.id
        LEFT JOIN FAULT_TYPES ft ON f.fault_type_id = ft.fault_type_id
        LEFT JOIN ASSET_FAULT_FLAGS pf ON f.previous_flag_id = pf.flag_id
        ${whereClause}
        ORDER BY
          f.recurrence_count DESC,
          CASE f.severity
            WHEN 'severe' THEN 1
            WHEN 'critical' THEN 2
            WHEN 'warning' THEN 3
          END,
          f.fault_count DESC,
          f.created_at DESC
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.VarChar, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching active flags:', error);
      throw error;
    }
  }

  /**
   * Get flags for a specific asset
   */
  static async getAssetFlags(assetId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          f.*,
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          u.first_name + ' ' + u.last_name AS resolved_by_name
        FROM ASSET_FAULT_FLAGS f
        LEFT JOIN FAULT_TYPES ft ON f.fault_type_id = ft.fault_type_id
        LEFT JOIN USER_MASTER u ON f.resolved_by = u.user_id
        WHERE f.asset_id = @assetId
        ORDER BY f.created_at DESC
      `;

      const result = await pool.request()
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching asset flags:', error);
      throw error;
    }
  }

  /**
   * Get flags for a product model
   */
  static async getProductFlags(productId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          f.*,
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          u.first_name + ' ' + u.last_name AS resolved_by_name
        FROM ASSET_FAULT_FLAGS f
        LEFT JOIN FAULT_TYPES ft ON f.fault_type_id = ft.fault_type_id
        LEFT JOIN USER_MASTER u ON f.resolved_by = u.user_id
        WHERE f.product_id = @productId
        ORDER BY f.created_at DESC
      `;

      const result = await pool.request()
        .input('productId', sql.UniqueIdentifier, productId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching product flags:', error);
      throw error;
    }
  }

  /**
   * Create a manual fault flag
   */
  static async createFlag(flagData) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO ASSET_FAULT_FLAGS (
          flag_id,
          asset_id,
          product_id,
          oem_id,
          flag_type,
          flag_reason,
          fault_type_id,
          fault_count,
          first_fault_date,
          last_fault_date,
          detection_period_months,
          threshold_rule,
          severity,
          is_active,
          is_resolved,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @assetId,
          @productId,
          @oemId,
          @flagType,
          @flagReason,
          @faultTypeId,
          @faultCount,
          @firstFaultDate,
          @lastFaultDate,
          @detectionPeriodMonths,
          @thresholdRule,
          @severity,
          1,
          0,
          GETDATE(),
          GETDATE()
        )
      `;

      const result = await pool.request()
        .input('assetId', sql.UniqueIdentifier, flagData.asset_id || null)
        .input('productId', sql.UniqueIdentifier, flagData.product_id || null)
        .input('oemId', sql.UniqueIdentifier, flagData.oem_id || null)
        .input('flagType', sql.VarChar(30), flagData.flag_type)
        .input('flagReason', sql.NVarChar(500), flagData.flag_reason)
        .input('faultTypeId', sql.UniqueIdentifier, flagData.fault_type_id || null)
        .input('faultCount', sql.Int, flagData.fault_count || 0)
        .input('firstFaultDate', sql.DateTime, flagData.first_fault_date || null)
        .input('lastFaultDate', sql.DateTime, flagData.last_fault_date || null)
        .input('detectionPeriodMonths', sql.Int, flagData.detection_period_months || null)
        .input('thresholdRule', sql.NVarChar(200), flagData.threshold_rule || null)
        .input('severity', sql.VarChar(20), flagData.severity || 'warning')
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating flag:', error);
      throw error;
    }
  }

  /**
   * Resolve a fault flag
   */
  static async resolveFlag(flagId, resolvedBy, resolutionData) {
    try {
      const pool = await connectDB();

      const query = `
        UPDATE ASSET_FAULT_FLAGS
        SET
          is_resolved = 1,
          resolved_by = @resolvedBy,
          resolved_at = GETDATE(),
          resolution_notes = @resolutionNotes,
          resolution_action = @resolutionAction,
          updated_at = GETDATE()
        OUTPUT INSERTED.*
        WHERE flag_id = @flagId
      `;

      const result = await pool.request()
        .input('flagId', sql.UniqueIdentifier, flagId)
        .input('resolvedBy', sql.UniqueIdentifier, resolvedBy)
        .input('resolutionNotes', sql.NVarChar(sql.MAX), resolutionData.resolution_notes || null)
        .input('resolutionAction', sql.VarChar(50), resolutionData.resolution_action || null)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error resolving flag:', error);
      throw error;
    }
  }

  /**
   * Deactivate a flag
   */
  static async deactivateFlag(flagId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('flagId', sql.UniqueIdentifier, flagId)
        .query(`
          UPDATE ASSET_FAULT_FLAGS
          SET is_active = 0, updated_at = GETDATE()
          WHERE flag_id = @flagId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deactivating flag:', error);
      throw error;
    }
  }

  /**
   * Run automatic fault analysis
   */
  static async runAutoAnalysis(options = {}) {
    try {
      const pool = await connectDB();

      const {
        assetMonths = 6,
        assetThreshold = 3,
        modelMonths = 3,
        modelThreshold = 5,
        cooldownDays = 30
      } = options;

      const result = await pool.request()
        .input('AssetMonths', sql.Int, assetMonths)
        .input('AssetThreshold', sql.Int, assetThreshold)
        .input('ModelMonths', sql.Int, modelMonths)
        .input('ModelThreshold', sql.Int, modelThreshold)
        .input('CooldownDays', sql.Int, cooldownDays)
        .execute('sp_AutoFlagProblematicAssets');

      return {
        flags_created: result.recordset[0]?.flags_created || 0
      };
    } catch (error) {
      console.error('Error running auto analysis:', error);
      throw error;
    }
  }

  /**
   * Analyze faults for a specific asset
   */
  static async analyzeAssetFaults(assetId = null, monthsPeriod = 6, threshold = 3) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('AssetId', sql.UniqueIdentifier, assetId)
        .input('MonthsPeriod', sql.Int, monthsPeriod)
        .input('FaultThreshold', sql.Int, threshold)
        .execute('sp_AnalyzeAssetFaults');

      return result.recordset;
    } catch (error) {
      console.error('Error analyzing asset faults:', error);
      throw error;
    }
  }

  /**
   * Analyze faults for product models/OEMs
   */
  static async analyzeModelFaults(productId = null, oemId = null, monthsPeriod = 3, threshold = 5) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ProductId', sql.UniqueIdentifier, productId)
        .input('OemId', sql.UniqueIdentifier, oemId)
        .input('MonthsPeriod', sql.Int, monthsPeriod)
        .input('FaultThreshold', sql.Int, threshold)
        .execute('sp_AnalyzeModelFaults');

      return result.recordset;
    } catch (error) {
      console.error('Error analyzing model faults:', error);
      throw error;
    }
  }

  /**
   * Get resolved flags history
   */
  static async getResolvedFlags(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE f.is_resolved = 1';
      const params = {};

      if (filters.flag_type) {
        whereClause += ' AND f.flag_type = @flagType';
        params.flagType = filters.flag_type;
      }

      if (filters.resolution_action) {
        whereClause += ' AND f.resolution_action = @resolutionAction';
        params.resolutionAction = filters.resolution_action;
      }

      // Date range filter
      if (filters.from_date) {
        whereClause += ' AND f.resolved_at >= @fromDate';
        params.fromDate = filters.from_date;
      }

      if (filters.to_date) {
        whereClause += ' AND f.resolved_at <= @toDate';
        params.toDate = filters.to_date;
      }

      const query = `
        SELECT
          f.*,
          -- Asset info
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          a.parent_asset_id,
          -- Parent asset info (if component)
          pa.asset_tag AS parent_asset_tag,
          -- Product info
          p.name AS product_name,
          p.model AS product_model,
          -- OEM info
          o.name AS oem_name,
          -- Fault type
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          -- Resolved by user
          u.first_name + ' ' + u.last_name AS resolved_by_name,
          u.email AS resolved_by_email
        FROM ASSET_FAULT_FLAGS f
        LEFT JOIN assets a ON f.asset_id = a.id
        LEFT JOIN assets pa ON a.parent_asset_id = pa.id
        LEFT JOIN products p ON f.product_id = p.id OR a.product_id = p.id
        LEFT JOIN oems o ON f.oem_id = o.id OR p.oem_id = o.id
        LEFT JOIN FAULT_TYPES ft ON f.fault_type_id = ft.fault_type_id
        LEFT JOIN USER_MASTER u ON f.resolved_by = u.user_id
        ${whereClause}
        ORDER BY f.resolved_at DESC
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        if (key === 'fromDate' || key === 'toDate') {
          request.input(key, sql.DateTime, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching resolved flags:', error);
      throw error;
    }
  }

  /**
   * Get flag statistics
   */
  static async getFlagStats() {
    try {
      const pool = await connectDB();

      // Get summary stats
      const summaryQuery = `
        SELECT
          COUNT(*) AS total_flags,
          SUM(CASE WHEN is_active = 1 AND is_resolved = 0 THEN 1 ELSE 0 END) AS active_flags,
          SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS resolved_flags,
          SUM(CASE WHEN recurrence_count > 0 AND is_active = 1 AND is_resolved = 0 THEN 1 ELSE 0 END) AS recurring_flags
        FROM ASSET_FAULT_FLAGS
      `;

      // Get flags by severity (active only)
      const severityQuery = `
        SELECT
          severity,
          COUNT(*) AS count
        FROM ASSET_FAULT_FLAGS
        WHERE is_active = 1 AND is_resolved = 0
        GROUP BY severity
      `;

      // Get flags by type (active only)
      const typeQuery = `
        SELECT
          flag_type,
          COUNT(*) AS count
        FROM ASSET_FAULT_FLAGS
        WHERE is_active = 1 AND is_resolved = 0
        GROUP BY flag_type
      `;

      const [summaryResult, severityResult, typeResult] = await Promise.all([
        pool.request().query(summaryQuery),
        pool.request().query(severityQuery),
        pool.request().query(typeQuery)
      ]);

      const summary = summaryResult.recordset[0] || {};

      return {
        totalFlags: summary.total_flags || 0,
        totalActive: summary.active_flags || 0,
        totalResolved: summary.resolved_flags || 0,
        recurringFlags: summary.recurring_flags || 0,
        flagsBySeverity: severityResult.recordset || [],
        flagsByType: typeResult.recordset || []
      };
    } catch (error) {
      console.error('Error fetching flag stats:', error);
      throw error;
    }
  }

  /**
   * Get problematic assets report
   */
  static async getProblematicAssetsReport() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          f.flag_id,
          f.flag_type,
          f.flag_reason,
          f.fault_count,
          f.severity,
          f.first_fault_date,
          f.last_fault_date,
          f.threshold_rule,
          f.created_at,
          f.recurrence_count,
          f.previous_flag_id,
          -- Asset
          a.asset_tag,
          a.serial_number,
          a.status AS asset_status,
          a.asset_type,
          a.parent_asset_id,
          -- Parent asset info (if component)
          pa.asset_tag AS parent_asset_tag,
          -- Product
          p.name AS product_name,
          p.model AS product_model,
          -- OEM
          o.name AS oem_name,
          -- Fault type
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          -- Assigned user
          u.first_name + ' ' + u.last_name AS assigned_to_name,
          u.email AS assigned_to_email,
          -- Department
          d.department_name,
          -- Previous flag info
          pf.resolved_at AS previous_resolved_at,
          pf.resolution_action AS previous_resolution_action,
          -- Component repairs count (for parent assets)
          (SELECT COUNT(*) FROM ASSET_REPAIR_HISTORY rh WHERE rh.parent_asset_id = a.id) AS component_repairs_count,
          -- Total repairs including components
          (SELECT COUNT(*) FROM ASSET_REPAIR_HISTORY rh WHERE rh.asset_id = a.id OR rh.parent_asset_id = a.id) AS total_repairs_with_components
        FROM ASSET_FAULT_FLAGS f
        LEFT JOIN assets a ON f.asset_id = a.id
        LEFT JOIN assets pa ON a.parent_asset_id = pa.id
        LEFT JOIN products p ON COALESCE(f.product_id, a.product_id) = p.id
        LEFT JOIN oems o ON COALESCE(f.oem_id, p.oem_id) = o.id
        LEFT JOIN FAULT_TYPES ft ON f.fault_type_id = ft.fault_type_id
        LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN ASSET_FAULT_FLAGS pf ON f.previous_flag_id = pf.flag_id
        WHERE f.is_active = 1 AND f.is_resolved = 0
        ORDER BY
          f.recurrence_count DESC,
          CASE f.severity WHEN 'severe' THEN 1 WHEN 'critical' THEN 2 ELSE 3 END,
          f.fault_count DESC
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error generating problematic assets report:', error);
      throw error;
    }
  }
}

module.exports = AssetFaultFlagsModel;
