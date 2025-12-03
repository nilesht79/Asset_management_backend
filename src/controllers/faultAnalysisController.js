/**
 * FAULT ANALYSIS CONTROLLER
 * Handles HTTP requests for fault analysis and problematic asset flagging
 */

const AssetFaultFlagsModel = require('../models/assetFaultFlags');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');

class FaultAnalysisController {
  /**
   * Get all active fault flags
   * GET /api/fault-analysis/flags
   */
  static async getActiveFlags(req, res) {
    try {
      const { flag_type, severity } = req.query;

      const filters = {};
      if (flag_type) filters.flag_type = flag_type;
      if (severity) filters.severity = severity;

      const flags = await AssetFaultFlagsModel.getActiveFlags(filters);
      return sendSuccess(res, { flags, count: flags.length });
    } catch (error) {
      console.error('Error fetching flags:', error);
      return sendError(res, error.message || 'Failed to fetch flags', 500);
    }
  }

  /**
   * Get flags for a specific asset
   * GET /api/fault-analysis/assets/:assetId/flags
   */
  static async getAssetFlags(req, res) {
    try {
      const { assetId } = req.params;

      const flags = await AssetFaultFlagsModel.getAssetFlags(assetId);
      return sendSuccess(res, { flags, count: flags.length });
    } catch (error) {
      console.error('Error fetching asset flags:', error);
      return sendError(res, error.message || 'Failed to fetch asset flags', 500);
    }
  }

  /**
   * Get flags for a product model
   * GET /api/fault-analysis/products/:productId/flags
   */
  static async getProductFlags(req, res) {
    try {
      const { productId } = req.params;

      const flags = await AssetFaultFlagsModel.getProductFlags(productId);
      return sendSuccess(res, { flags, count: flags.length });
    } catch (error) {
      console.error('Error fetching product flags:', error);
      return sendError(res, error.message || 'Failed to fetch product flags', 500);
    }
  }

  /**
   * Create a manual fault flag
   * POST /api/fault-analysis/flags
   */
  static async createFlag(req, res) {
    try {
      const flagData = req.body;

      if (!flagData.flag_type) {
        return sendError(res, 'Flag type is required', 400);
      }

      if (!flagData.flag_reason) {
        return sendError(res, 'Flag reason is required', 400);
      }

      const validTypes = ['asset', 'product_model', 'oem'];
      if (!validTypes.includes(flagData.flag_type)) {
        return sendError(res, `Flag type must be one of: ${validTypes.join(', ')}`, 400);
      }

      // Validate that appropriate ID is provided
      if (flagData.flag_type === 'asset' && !flagData.asset_id) {
        return sendError(res, 'Asset ID is required for asset flag type', 400);
      }
      if (flagData.flag_type === 'product_model' && !flagData.product_id) {
        return sendError(res, 'Product ID is required for product_model flag type', 400);
      }
      if (flagData.flag_type === 'oem' && !flagData.oem_id) {
        return sendError(res, 'OEM ID is required for oem flag type', 400);
      }

      const result = await AssetFaultFlagsModel.createFlag(flagData);
      return sendCreated(res, result, 'Fault flag created successfully');
    } catch (error) {
      console.error('Error creating flag:', error);
      return sendError(res, error.message || 'Failed to create flag', 500);
    }
  }

  /**
   * Resolve a fault flag
   * PUT /api/fault-analysis/flags/:flagId/resolve
   */
  static async resolveFlag(req, res) {
    try {
      const { flagId } = req.params;
      const resolvedBy = req.oauth.user.id;
      const { resolution_notes, resolution_action } = req.body;

      if (!resolution_action) {
        return sendError(res, 'Resolution action is required', 400);
      }

      const validActions = ['replaced', 'repaired', 'retired', 'vendor_notified', 'monitoring', 'dismissed', 'other'];
      if (!validActions.includes(resolution_action)) {
        return sendError(res, `Resolution action must be one of: ${validActions.join(', ')}`, 400);
      }

      const result = await AssetFaultFlagsModel.resolveFlag(flagId, resolvedBy, {
        resolution_notes,
        resolution_action
      });

      if (!result) {
        return sendNotFound(res, 'Flag not found');
      }

      return sendSuccess(res, result, 'Flag resolved successfully');
    } catch (error) {
      console.error('Error resolving flag:', error);
      return sendError(res, error.message || 'Failed to resolve flag', 500);
    }
  }

  /**
   * Get resolved flags history
   * GET /api/fault-analysis/flags/history
   */
  static async getResolvedFlags(req, res) {
    try {
      const { flag_type, resolution_action, from_date, to_date } = req.query;

      const filters = {};
      if (flag_type) filters.flag_type = flag_type;
      if (resolution_action) filters.resolution_action = resolution_action;
      if (from_date) filters.from_date = from_date;
      if (to_date) filters.to_date = to_date;

      const flags = await AssetFaultFlagsModel.getResolvedFlags(filters);
      return sendSuccess(res, { flags, count: flags.length });
    } catch (error) {
      console.error('Error fetching resolved flags:', error);
      return sendError(res, error.message || 'Failed to fetch resolved flags history', 500);
    }
  }

  /**
   * Deactivate a flag
   * DELETE /api/fault-analysis/flags/:flagId
   */
  static async deactivateFlag(req, res) {
    try {
      const { flagId } = req.params;

      const result = await AssetFaultFlagsModel.deactivateFlag(flagId);

      if (!result) {
        return sendNotFound(res, 'Flag not found');
      }

      return sendSuccess(res, null, 'Flag deactivated successfully');
    } catch (error) {
      console.error('Error deactivating flag:', error);
      return sendError(res, error.message || 'Failed to deactivate flag', 500);
    }
  }

  /**
   * Run automatic fault analysis
   * POST /api/fault-analysis/run
   */
  static async runAutoAnalysis(req, res) {
    try {
      const {
        asset_months = 6,
        asset_threshold = 3,
        model_months = 3,
        model_threshold = 5,
        cooldown_days = 30
      } = req.body;

      const result = await AssetFaultFlagsModel.runAutoAnalysis({
        assetMonths: parseInt(asset_months),
        assetThreshold: parseInt(asset_threshold),
        modelMonths: parseInt(model_months),
        modelThreshold: parseInt(model_threshold),
        cooldownDays: parseInt(cooldown_days)
      });

      return sendSuccess(res, result, `Auto analysis complete. ${result.flags_created} new flags created.`);
    } catch (error) {
      console.error('Error running auto analysis:', error);
      return sendError(res, error.message || 'Failed to run auto analysis', 500);
    }
  }

  /**
   * Analyze faults for specific asset
   * GET /api/fault-analysis/analyze/asset/:assetId
   */
  static async analyzeAssetFaults(req, res) {
    try {
      const { assetId } = req.params;
      const { months = 6, threshold = 3 } = req.query;

      const results = await AssetFaultFlagsModel.analyzeAssetFaults(
        assetId,
        parseInt(months),
        parseInt(threshold)
      );

      return sendSuccess(res, {
        asset_id: assetId,
        analysis_period_months: parseInt(months),
        threshold: parseInt(threshold),
        recurring_faults: results,
        has_issues: results.length > 0
      });
    } catch (error) {
      console.error('Error analyzing asset faults:', error);
      return sendError(res, error.message || 'Failed to analyze asset faults', 500);
    }
  }

  /**
   * Analyze faults for all assets
   * GET /api/fault-analysis/analyze/assets
   */
  static async analyzeAllAssetFaults(req, res) {
    try {
      const { months = 6, threshold = 3 } = req.query;

      const results = await AssetFaultFlagsModel.analyzeAssetFaults(
        null,
        parseInt(months),
        parseInt(threshold)
      );

      return sendSuccess(res, {
        analysis_period_months: parseInt(months),
        threshold: parseInt(threshold),
        problematic_assets: results,
        count: results.length
      });
    } catch (error) {
      console.error('Error analyzing all asset faults:', error);
      return sendError(res, error.message || 'Failed to analyze faults', 500);
    }
  }

  /**
   * Analyze faults for product models/OEMs
   * GET /api/fault-analysis/analyze/models
   */
  static async analyzeModelFaults(req, res) {
    try {
      const { product_id, oem_id, months = 3, threshold = 5 } = req.query;

      const results = await AssetFaultFlagsModel.analyzeModelFaults(
        product_id || null,
        oem_id || null,
        parseInt(months),
        parseInt(threshold)
      );

      return sendSuccess(res, {
        analysis_period_months: parseInt(months),
        threshold: parseInt(threshold),
        problematic_models: results,
        count: results.length
      });
    } catch (error) {
      console.error('Error analyzing model faults:', error);
      return sendError(res, error.message || 'Failed to analyze model faults', 500);
    }
  }

  /**
   * Get flag statistics
   * GET /api/fault-analysis/stats
   */
  static async getFlagStats(req, res) {
    try {
      const stats = await AssetFaultFlagsModel.getFlagStats();
      return sendSuccess(res, stats);
    } catch (error) {
      console.error('Error fetching flag stats:', error);
      return sendError(res, error.message || 'Failed to fetch stats', 500);
    }
  }

  /**
   * Get problematic assets report
   * GET /api/fault-analysis/reports/problematic-assets
   */
  static async getProblematicAssetsReport(req, res) {
    try {
      const report = await AssetFaultFlagsModel.getProblematicAssetsReport();
      return sendSuccess(res, {
        report,
        count: report.length,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error generating report:', error);
      return sendError(res, error.message || 'Failed to generate report', 500);
    }
  }
}

module.exports = FaultAnalysisController;
