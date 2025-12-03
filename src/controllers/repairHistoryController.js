/**
 * REPAIR HISTORY CONTROLLER
 * Handles HTTP requests for asset repair history
 */

const AssetRepairHistoryModel = require('../models/assetRepairHistory');
const FaultTypesModel = require('../models/faultTypes');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');
const { connectDB, sql } = require('../config/database');

class RepairHistoryController {
  /**
   * Create repair entry
   * POST /api/repair-history
   */
  static async createRepairEntry(req, res) {
    try {
      const repairData = {
        ...req.body,
        created_by: req.oauth.user.id
      };

      if (!repairData.asset_id) {
        return sendError(res, 'Asset ID is required', 400);
      }

      if (!repairData.fault_description) {
        return sendError(res, 'Fault description is required', 400);
      }

      // Auto-detect parent asset if not provided
      // This handles the case when a component is repaired
      if (!repairData.parent_asset_id) {
        const pool = await connectDB();
        const assetResult = await pool.request()
          .input('assetId', sql.UniqueIdentifier, repairData.asset_id)
          .query('SELECT parent_asset_id FROM assets WHERE id = @assetId');

        if (assetResult.recordset[0]?.parent_asset_id) {
          repairData.parent_asset_id = assetResult.recordset[0].parent_asset_id;
        }
      }

      const result = await AssetRepairHistoryModel.createRepairEntry(repairData);
      return sendCreated(res, result, 'Repair entry created successfully');
    } catch (error) {
      console.error('Error creating repair entry:', error);
      return sendError(res, error.message || 'Failed to create repair entry', 500);
    }
  }

  /**
   * Get repair history for an asset
   * GET /api/assets/:assetId/repair-history
   */
  static async getAssetRepairHistory(req, res) {
    try {
      const { assetId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const result = await AssetRepairHistoryModel.getAssetRepairHistory(assetId, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      return sendSuccess(res, result);
    } catch (error) {
      console.error('Error fetching repair history:', error);
      return sendError(res, error.message || 'Failed to fetch repair history', 500);
    }
  }

  /**
   * Get repair entry by ID
   * GET /api/repair-history/:repairId
   */
  static async getRepairById(req, res) {
    try {
      const { repairId } = req.params;

      const repair = await AssetRepairHistoryModel.getRepairById(repairId);

      if (!repair) {
        return sendNotFound(res, 'Repair entry not found');
      }

      return sendSuccess(res, repair);
    } catch (error) {
      console.error('Error fetching repair:', error);
      return sendError(res, error.message || 'Failed to fetch repair entry', 500);
    }
  }

  /**
   * Update repair entry
   * PUT /api/repair-history/:repairId
   */
  static async updateRepairEntry(req, res) {
    try {
      const { repairId } = req.params;
      const updateData = req.body;

      const result = await AssetRepairHistoryModel.updateRepairEntry(repairId, updateData);

      if (!result) {
        return sendNotFound(res, 'Repair entry not found');
      }

      return sendSuccess(res, result, 'Repair entry updated successfully');
    } catch (error) {
      console.error('Error updating repair entry:', error);
      return sendError(res, error.message || 'Failed to update repair entry', 500);
    }
  }

  /**
   * Delete repair entry
   * DELETE /api/repair-history/:repairId
   */
  static async deleteRepairEntry(req, res) {
    try {
      const { repairId } = req.params;

      const result = await AssetRepairHistoryModel.deleteRepairEntry(repairId);

      if (!result) {
        return sendNotFound(res, 'Repair entry not found');
      }

      return sendSuccess(res, null, 'Repair entry deleted successfully');
    } catch (error) {
      console.error('Error deleting repair entry:', error);
      return sendError(res, error.message || 'Failed to delete repair entry', 500);
    }
  }

  /**
   * Get all repairs with filters
   * GET /api/repair-history
   */
  static async getAllRepairs(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        asset_id,
        fault_type_id,
        engineer_id,
        repair_status,
        date_from,
        date_to,
        warranty_claim
      } = req.query;

      const filters = {};
      if (asset_id) filters.asset_id = asset_id;
      if (fault_type_id) filters.fault_type_id = fault_type_id;
      if (engineer_id) filters.engineer_id = engineer_id;
      if (repair_status) filters.repair_status = repair_status;
      if (date_from) filters.date_from = new Date(date_from);
      if (date_to) filters.date_to = new Date(date_to);
      if (warranty_claim !== undefined) filters.warranty_claim = warranty_claim === 'true';

      const result = await AssetRepairHistoryModel.getAllRepairs(filters, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      return sendSuccess(res, result);
    } catch (error) {
      console.error('Error fetching repairs:', error);
      return sendError(res, error.message || 'Failed to fetch repairs', 500);
    }
  }

  /**
   * Get asset repair statistics
   * GET /api/assets/:assetId/repair-stats
   */
  static async getAssetRepairStats(req, res) {
    try {
      const { assetId } = req.params;

      const stats = await AssetRepairHistoryModel.getAssetRepairStats(assetId);
      return sendSuccess(res, stats);
    } catch (error) {
      console.error('Error fetching repair stats:', error);
      return sendError(res, error.message || 'Failed to fetch repair stats', 500);
    }
  }

  /**
   * Get repair cost summary
   * GET /api/repair-history/cost-summary
   */
  static async getRepairCostSummary(req, res) {
    try {
      const { date_from, date_to } = req.query;

      const filters = {};
      if (date_from) filters.date_from = new Date(date_from);
      if (date_to) filters.date_to = new Date(date_to);

      const summary = await AssetRepairHistoryModel.getRepairCostSummary(filters);
      return sendSuccess(res, summary);
    } catch (error) {
      console.error('Error fetching cost summary:', error);
      return sendError(res, error.message || 'Failed to fetch cost summary', 500);
    }
  }

  /**
   * Create repairs from ticket closure
   * POST /api/repair-history/from-ticket/:ticketId
   */
  static async createFromTicketClosure(req, res) {
    try {
      const { ticketId } = req.params;
      const closureData = req.body;
      const createdBy = req.oauth.user.id;

      const repairs = await AssetRepairHistoryModel.createFromTicketClosure(
        ticketId,
        closureData,
        createdBy
      );

      return sendCreated(res, {
        repairs,
        count: repairs.length
      }, `${repairs.length} repair entries created from ticket`);
    } catch (error) {
      console.error('Error creating repairs from ticket:', error);
      return sendError(res, error.message || 'Failed to create repair entries', 500);
    }
  }

  /**
   * Get all fault types
   * GET /api/repair-history/fault-types
   */
  static async getFaultTypes(req, res) {
    try {
      const { include_inactive, grouped } = req.query;

      if (grouped === 'true') {
        const faultTypes = await FaultTypesModel.getFaultTypesByCategory();
        return sendSuccess(res, faultTypes);
      }

      const faultTypes = await FaultTypesModel.getAllFaultTypes(include_inactive === 'true');
      return sendSuccess(res, { fault_types: faultTypes });
    } catch (error) {
      console.error('Error fetching fault types:', error);
      return sendError(res, error.message || 'Failed to fetch fault types', 500);
    }
  }

  /**
   * Create fault type
   * POST /api/repair-history/fault-types
   */
  static async createFaultType(req, res) {
    try {
      const { name, category, description } = req.body;

      if (!name || !category) {
        return sendError(res, 'Name and category are required', 400);
      }

      const validCategories = ['Hardware', 'Software', 'Network', 'Electrical', 'Mechanical', 'Other'];
      if (!validCategories.includes(category)) {
        return sendError(res, `Category must be one of: ${validCategories.join(', ')}`, 400);
      }

      const result = await FaultTypesModel.createFaultType({ name, category, description });
      return sendCreated(res, result, 'Fault type created successfully');
    } catch (error) {
      console.error('Error creating fault type:', error);
      if (error.message.includes('already exists')) {
        return sendError(res, error.message, 409);
      }
      return sendError(res, error.message || 'Failed to create fault type', 500);
    }
  }

  /**
   * Update fault type
   * PUT /api/repair-history/fault-types/:faultTypeId
   */
  static async updateFaultType(req, res) {
    try {
      const { faultTypeId } = req.params;
      const updateData = req.body;

      const result = await FaultTypesModel.updateFaultType(faultTypeId, updateData);

      if (!result) {
        return sendNotFound(res, 'Fault type not found');
      }

      return sendSuccess(res, result, 'Fault type updated successfully');
    } catch (error) {
      console.error('Error updating fault type:', error);
      return sendError(res, error.message || 'Failed to update fault type', 500);
    }
  }

  /**
   * Delete fault type (soft delete)
   * DELETE /api/repair-history/fault-types/:faultTypeId
   */
  static async deleteFaultType(req, res) {
    try {
      const { faultTypeId } = req.params;

      const result = await FaultTypesModel.deleteFaultType(faultTypeId);

      if (!result) {
        return sendNotFound(res, 'Fault type not found');
      }

      return sendSuccess(res, null, 'Fault type deleted successfully');
    } catch (error) {
      console.error('Error deleting fault type:', error);
      return sendError(res, error.message || 'Failed to delete fault type', 500);
    }
  }

  /**
   * Get fault type statistics
   * GET /api/repair-history/fault-types/stats
   */
  static async getFaultTypeStats(req, res) {
    try {
      const stats = await FaultTypesModel.getFaultTypeStats();
      return sendSuccess(res, { stats });
    } catch (error) {
      console.error('Error fetching fault type stats:', error);
      return sendError(res, error.message || 'Failed to fetch stats', 500);
    }
  }
}

module.exports = RepairHistoryController;
