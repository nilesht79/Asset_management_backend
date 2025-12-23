/**
 * TICKET ASSETS CONTROLLER
 * Handles HTTP requests for ticket-asset linking
 */

const TicketAssetsModel = require('../models/ticketAssets');
const TicketModel = require('../models/ticket');
const SlaTrackingModel = require('../models/slaTracking');
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

      // Check if SLA tracking exists - if not, initialize it now that assets are linked
      try {
        const existingTracking = await SlaTrackingModel.getTracking(ticketId);
        if (!existingTracking) {
          const ticket = await TicketModel.getTicketById(ticketId);
          if (ticket) {
            const ticketContext = {
              ticket_id: ticketId,
              ticket_type: ticket.ticket_type || 'internal',
              service_type: ticket.service_type || 'general',
              ticket_channel: 'portal',
              priority: ticket.priority || 'medium',
              user_id: ticket.created_by_user_id,
              asset_ids: [asset_id]
            };
            await SlaTrackingModel.initializeTracking(ticketId, ticketContext);
            console.log(`SLA tracking initialized for ticket ${ticket.ticket_number} after asset link`);
          }
        }
      } catch (slaError) {
        console.error('Failed to initialize SLA tracking after asset link:', slaError.message);
        // Continue - asset was linked successfully
      }

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

      // Check if SLA tracking exists - if not, initialize it now that assets are linked
      if (results.length > 0) {
        try {
          const existingTracking = await SlaTrackingModel.getTracking(ticketId);
          if (!existingTracking) {
            const ticket = await TicketModel.getTicketById(ticketId);
            if (ticket) {
              const ticketContext = {
                ticket_id: ticketId,
                ticket_type: ticket.ticket_type || 'internal',
                service_type: ticket.service_type || 'general',
                ticket_channel: 'portal',
                priority: ticket.priority || 'medium',
                user_id: ticket.created_by_user_id,
                asset_ids: asset_ids
              };
              await SlaTrackingModel.initializeTracking(ticketId, ticketContext);
              console.log(`SLA tracking initialized for ticket ${ticket.ticket_number} after bulk asset link`);
            }
          }
        } catch (slaError) {
          console.error('Failed to initialize SLA tracking after bulk asset link:', slaError.message);
          // Continue - assets were linked successfully
        }
      }

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
      const userId = req.user?.id || req.oauth?.user?.id;
      const userRole = req.user?.role || req.oauth?.user?.role;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      // If user is an employee, verify they own the ticket
      if (userRole === 'employee') {
        const ticket = await TicketModel.getTicketById(ticketId);
        if (!ticket || ticket.created_by_user_id !== userId) {
          return sendError(res, 'Access denied. You can only view your own tickets.', 403);
        }
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
   * Get software installed on employee's assets for ticket creation
   * GET /api/tickets/my-software or GET /api/tickets/employee-software/:userId
   */
  static async getEmployeeSoftware(req, res) {
    try {
      // Get user ID from params or from authenticated user
      const userId = req.params.userId || req.oauth.user.id;

      const software = await TicketAssetsModel.getEmployeeSoftware(userId);

      // Group by software name for frontend convenience
      const grouped = {};
      software.forEach(item => {
        const key = item.software_name;
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(item);
      });

      return sendSuccess(res, {
        software,
        grouped,
        total: software.length
      });
    } catch (error) {
      console.error('Error fetching employee software:', error);
      return sendError(res, error.message || 'Failed to fetch employee software', 500);
    }
  }

  /**
   * Get all software linked to a ticket
   * GET /api/tickets/:id/software
   */
  static async getTicketSoftware(req, res) {
    try {
      const ticketId = req.params.id || req.params.ticketId;
      const userId = req.user?.id || req.oauth?.user?.id;
      const userRole = req.user?.role || req.oauth?.user?.role;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      // If user is an employee, verify they own the ticket
      if (userRole === 'employee') {
        const ticket = await TicketModel.getTicketById(ticketId);
        if (!ticket || ticket.created_by_user_id !== userId) {
          return sendError(res, 'Access denied. You can only view your own tickets.', 403);
        }
      }

      const software = await TicketAssetsModel.getTicketSoftware(ticketId);

      // Group by software name for convenience
      const grouped = {};
      software.forEach(item => {
        const key = item.software_name || 'Unknown';
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(item);
      });

      return sendSuccess(res, { software, grouped, count: software.length });
    } catch (error) {
      console.error('Error fetching ticket software:', error);
      return sendError(res, error.message || 'Failed to fetch ticket software', 500);
    }
  }

  /**
   * Unlink software from a ticket
   * DELETE /api/tickets/:ticketId/software/:installationId
   */
  static async unlinkSoftware(req, res) {
    try {
      const { ticketId, installationId } = req.params;

      const result = await TicketAssetsModel.unlinkSoftware(ticketId, installationId);

      if (!result) {
        return sendNotFound(res, 'Software link not found');
      }

      return sendSuccess(res, null, 'Software unlinked from ticket successfully');
    } catch (error) {
      console.error('Error unlinking software:', error);
      return sendError(res, error.message || 'Failed to unlink software', 500);
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
      const userId = req.user?.id || req.oauth?.user?.id;
      const userRole = req.user?.role || req.oauth?.user?.role;

      if (!ticketId) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      // If user is an employee, verify they own the ticket
      if (userRole === 'employee') {
        const ticket = await TicketModel.getTicketById(ticketId);
        if (!ticket || ticket.created_by_user_id !== userId) {
          return sendError(res, 'Access denied. You can only view your own tickets.', 403);
        }
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
