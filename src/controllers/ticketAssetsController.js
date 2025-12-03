/**
 * TICKET ASSETS CONTROLLER
 * Handles HTTP requests for ticket-asset linking
 */

const TicketAssetsModel = require('../models/ticketAssets');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');

class TicketAssetsController {
  /**
   * Link asset to ticket
   * POST /api/tickets/:id/assets
   */
  static async linkAsset(req, res) {
    try {
      // Support both :id and :ticketId parameter names
      const ticketId = req.params.id || req.params.ticketId;
      const { asset_id, notes } = req.body;
      const addedBy = req.oauth.user.id;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      if (!asset_id) {
        return sendError(res, 'Asset ID is required', 400);
      }

      const result = await TicketAssetsModel.linkAsset(ticketId, asset_id, addedBy, notes);
      return sendCreated(res, result, 'Asset linked to ticket successfully');
    } catch (error) {
      console.error('Error linking asset:', error);
      if (error.message === 'Asset is already linked to this ticket') {
        return sendError(res, error.message, 409);
      }
      return sendError(res, error.message || 'Failed to link asset', 500);
    }
  }

  /**
   * Link multiple assets to ticket
   * POST /api/tickets/:id/assets/bulk
   */
  static async linkMultipleAssets(req, res) {
    try {
      // Support both :id and :ticketId parameter names
      const ticketId = req.params.id || req.params.ticketId;
      const { asset_ids } = req.body;
      const addedBy = req.oauth.user.id;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      if (!asset_ids || !Array.isArray(asset_ids) || asset_ids.length === 0) {
        return sendError(res, 'Asset IDs array is required', 400);
      }

      const results = await TicketAssetsModel.linkMultipleAssets(ticketId, asset_ids, addedBy);
      return sendCreated(res, {
        linked_count: results.length,
        assets: results
      }, `${results.length} assets linked to ticket`);
    } catch (error) {
      console.error('Error linking multiple assets:', error);
      return sendError(res, error.message || 'Failed to link assets', 500);
    }
  }

  /**
   * Unlink asset from ticket
   * DELETE /api/tickets/:ticketId/assets/:assetId
   */
  static async unlinkAsset(req, res) {
    try {
      const { ticketId, assetId } = req.params;

      const result = await TicketAssetsModel.unlinkAsset(ticketId, assetId);

      if (!result) {
        return sendNotFound(res, 'Asset link not found');
      }

      return sendSuccess(res, null, 'Asset unlinked from ticket successfully');
    } catch (error) {
      console.error('Error unlinking asset:', error);
      return sendError(res, error.message || 'Failed to unlink asset', 500);
    }
  }

  /**
   * Get all assets linked to a ticket
   * GET /api/tickets/:id/assets
   */
  static async getTicketAssets(req, res) {
    try {
      // Support both :id and :ticketId parameter names
      const ticketId = req.params.id || req.params.ticketId;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      const assets = await TicketAssetsModel.getTicketAssets(ticketId);
      return sendSuccess(res, { assets, count: assets.length });
    } catch (error) {
      console.error('Error fetching ticket assets:', error);
      return sendError(res, error.message || 'Failed to fetch ticket assets', 500);
    }
  }

  /**
   * Get all tickets linked to an asset
   * GET /api/assets/:assetId/tickets
   */
  static async getAssetTickets(req, res) {
    try {
      const { assetId } = req.params;

      const tickets = await TicketAssetsModel.getAssetTickets(assetId);
      return sendSuccess(res, { tickets, count: tickets.length });
    } catch (error) {
      console.error('Error fetching asset tickets:', error);
      return sendError(res, error.message || 'Failed to fetch asset tickets', 500);
    }
  }

  /**
   * Get employee's assets for ticket creation
   * GET /api/tickets/my-assets or GET /api/tickets/employee-assets/:userId
   */
  static async getEmployeeAssets(req, res) {
    try {
      // Get user ID from params or from authenticated user
      const userId = req.params.userId || req.oauth.user.id;

      const assets = await TicketAssetsModel.getEmployeeAssets(userId);

      // Group assets by type for frontend convenience
      const grouped = {
        standalone: assets.filter(a => a.asset_type === 'standalone'),
        parent: assets.filter(a => a.asset_type === 'parent'),
        components: assets.filter(a => a.asset_type === 'component')
      };

      return sendSuccess(res, {
        assets,
        grouped,
        total: assets.length
      });
    } catch (error) {
      console.error('Error fetching employee assets:', error);
      return sendError(res, error.message || 'Failed to fetch employee assets', 500);
    }
  }

  /**
   * Check if asset is linked to ticket
   * GET /api/tickets/:id/assets/:assetId/check
   */
  static async checkAssetLink(req, res) {
    try {
      // Support both :id and :ticketId parameter names
      const ticketId = req.params.id || req.params.ticketId;
      const { assetId } = req.params;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      const isLinked = await TicketAssetsModel.isAssetLinked(ticketId, assetId);
      return sendSuccess(res, { is_linked: isLinked });
    } catch (error) {
      console.error('Error checking asset link:', error);
      return sendError(res, error.message || 'Failed to check asset link', 500);
    }
  }

  /**
   * Get count of assets linked to ticket
   * GET /api/tickets/:id/assets/count
   */
  static async getAssetCount(req, res) {
    try {
      // Support both :id and :ticketId parameter names
      const ticketId = req.params.id || req.params.ticketId;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      const count = await TicketAssetsModel.getTicketAssetCount(ticketId);
      return sendSuccess(res, { count });
    } catch (error) {
      console.error('Error getting asset count:', error);
      return sendError(res, error.message || 'Failed to get asset count', 500);
    }
  }
}

module.exports = TicketAssetsController;
