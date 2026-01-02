/**
 * SLA TICKET INTEGRATION SERVICE
 * Integrates SLA tracking with ticket lifecycle events
 * This service should be called from ticket controller during ticket events
 */

const SlaTrackingModel = require('../models/slaTracking');
const slaMatchingEngine = require('./slaMatchingEngine');
const { connectDB, sql } = require('../config/database');

class SlaTicketIntegration {
  /**
   * Handle ticket creation - Initialize SLA tracking
   * @param {Object} ticket - Created ticket object
   * @param {Array} assetIds - Linked asset IDs
   */
  async onTicketCreated(ticket, assetIds = []) {
    try {
      const ticketContext = {
        ticket_id: ticket.ticket_id,
        ticket_type: ticket.ticket_type || 'incident',
        ticket_channel: ticket.ticket_channel || 'portal',
        priority: ticket.priority,
        user_id: ticket.created_by_user_id,
        asset_ids: assetIds
      };

      const result = await SlaTrackingModel.initializeTracking(
        ticket.ticket_id,
        ticketContext
      );

      console.log(`SLA tracking initialized for ticket ${ticket.ticket_number}: Rule "${result.rule.rule_name}"`);

      return result;
    } catch (error) {
      console.error('Error initializing SLA on ticket creation:', error);
      // Don't throw - SLA initialization shouldn't block ticket creation
      return null;
    }
  }

  /**
   * Handle ticket status change
   * @param {string} ticketId - Ticket ID
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @param {string} userId - User making the change
   */
  async onStatusChanged(ticketId, oldStatus, newStatus, userId) {
    try {
      const tracking = await SlaTrackingModel.getTracking(ticketId);
      if (!tracking) {
        console.log(`No SLA tracking found for ticket ${ticketId}`);
        return null;
      }

      // Parse pause conditions from the rule
      let pauseConditions = {};
      try {
        pauseConditions = JSON.parse(tracking.pause_conditions || '{}');
      } catch (e) {
        pauseConditions = {};
      }

      // Check if new status should pause SLA
      const pauseStatuses = ['pending_closure', 'awaiting_info', 'on_hold'];
      const shouldPause = pauseStatuses.includes(newStatus) ||
                          (pauseConditions[newStatus] === true);

      // Check if resuming from pause status
      const wasInPauseStatus = pauseStatuses.includes(oldStatus) ||
                               (pauseConditions[oldStatus] === true);

      if (shouldPause && !tracking.is_paused) {
        // Pause the timer
        const pauseReason = `Status changed to ${newStatus}`;
        await SlaTrackingModel.pauseTimer(ticketId, pauseReason, userId);
        console.log(`SLA paused for ticket ${ticketId}: ${pauseReason}`);
      } else if (wasInPauseStatus && !shouldPause && tracking.is_paused) {
        // Resume the timer
        await SlaTrackingModel.resumeTimer(ticketId, userId);
        console.log(`SLA resumed for ticket ${ticketId}: Status changed to ${newStatus}`);
      }

      // Check if ticket is being closed
      if (newStatus === 'closed' || newStatus === 'cancelled') {
        await SlaTrackingModel.stopTracking(ticketId, tracking.sla_status);
        console.log(`SLA tracking stopped for ticket ${ticketId}: ${newStatus}`);
      }

      return await SlaTrackingModel.getTracking(ticketId);
    } catch (error) {
      console.error('Error handling status change for SLA:', error);
      return null;
    }
  }

  /**
   * Handle ticket priority change - may need to re-evaluate SLA rule
   * @param {string} ticketId - Ticket ID
   * @param {string} oldPriority - Previous priority
   * @param {string} newPriority - New priority
   */
  async onPriorityChanged(ticketId, oldPriority, newPriority) {
    try {
      // Check if we need to re-evaluate the SLA rule
      const result = await slaMatchingEngine.reEvaluateTicketSla(ticketId);

      if (result.changed) {
        console.log(`SLA rule changed for ticket ${ticketId} due to priority change: ${result.rule.rule_name}`);
        // Note: In a real implementation, you might want to:
        // 1. Update the tracking record with new rule
        // 2. Recalculate deadlines
        // 3. Log the change
      }

      return result;
    } catch (error) {
      console.error('Error handling priority change for SLA:', error);
      return null;
    }
  }

  /**
   * Handle asset linked to ticket - may need to re-evaluate SLA rule
   * @param {string} ticketId - Ticket ID
   * @param {string} assetId - Linked asset ID
   */
  async onAssetLinked(ticketId, assetId) {
    try {
      const result = await slaMatchingEngine.reEvaluateTicketSla(ticketId);

      if (result.changed) {
        console.log(`SLA rule may need update for ticket ${ticketId} due to asset link: ${result.rule.rule_name}`);
      }

      return result;
    } catch (error) {
      console.error('Error handling asset link for SLA:', error);
      return null;
    }
  }

  /**
   * Handle ticket assignment - might affect SLA
   * @param {string} ticketId - Ticket ID
   * @param {string} oldEngineerId - Previous engineer
   * @param {string} newEngineerId - New engineer
   */
  async onTicketAssigned(ticketId, oldEngineerId, newEngineerId) {
    try {
      // Update elapsed time when assignment changes
      const tracking = await SlaTrackingModel.updateElapsedTime(ticketId);

      console.log(`Ticket ${ticketId} assigned, SLA status: ${tracking?.sla_status}`);

      return tracking;
    } catch (error) {
      console.error('Error handling ticket assignment for SLA:', error);
      return null;
    }
  }

  /**
   * Handle ticket reopened - restart SLA tracking
   * @param {string} ticketId - Ticket ID
   * @param {Object} ticket - Ticket object
   */
  async onTicketReopened(ticketId, ticket) {
    try {
      const pool = await connectDB();

      // Check if tracking exists
      const existingTracking = await SlaTrackingModel.getTracking(ticketId);

      if (existingTracking) {
        // Reset the tracking
        await pool.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .query(`
            UPDATE TICKET_SLA_TRACKING SET
              resolved_at = NULL,
              final_status = NULL,
              is_paused = 0,
              pause_started_at = NULL,
              current_pause_reason = NULL,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId
          `);

        console.log(`SLA tracking reactivated for ticket ${ticketId}`);
        return await SlaTrackingModel.getTracking(ticketId);
      } else {
        // Initialize new tracking
        return await this.onTicketCreated(ticket, []);
      }
    } catch (error) {
      console.error('Error handling ticket reopen for SLA:', error);
      return null;
    }
  }

  /**
   * Get SLA status for display in ticket list/details
   * @param {string} ticketId - Ticket ID
   */
  async getSlaStatus(ticketId) {
    try {
      const tracking = await SlaTrackingModel.updateElapsedTime(ticketId);

      if (!tracking) {
        return null;
      }

      const remaining = tracking.max_tat_minutes - tracking.business_elapsed_minutes;

      return {
        status: tracking.sla_status,
        elapsed_minutes: tracking.business_elapsed_minutes,
        remaining_minutes: Math.max(0, remaining),
        percent_used: Math.min(100, Math.round((tracking.business_elapsed_minutes / tracking.max_tat_minutes) * 100)),
        is_paused: tracking.is_paused,
        is_breached: tracking.sla_status === 'breached',
        rule_name: tracking.rule_name,
        min_tat: tracking.min_tat_minutes,
        avg_tat: tracking.avg_tat_minutes,
        max_tat: tracking.max_tat_minutes
      };
    } catch (error) {
      console.error('Error getting SLA status:', error);
      return null;
    }
  }

  /**
   * Bulk get SLA status for multiple tickets
   * @param {Array} ticketIds - Array of ticket IDs
   */
  async getBulkSlaStatus(ticketIds) {
    try {
      if (!ticketIds || ticketIds.length === 0) {
        return {};
      }

      const summary = await slaMatchingEngine.getBulkSlaSummary(ticketIds);

      const result = {};
      for (const item of summary) {
        result[item.ticket_id] = {
          status: item.calculated_status,
          elapsed_minutes: item.business_elapsed_minutes,
          percent_used: item.percent_used,
          is_paused: item.is_paused,
          is_breached: item.calculated_status === 'breached',
          rule_name: item.rule_name
        };
      }

      return result;
    } catch (error) {
      console.error('Error getting bulk SLA status:', error);
      return {};
    }
  }
}

module.exports = new SlaTicketIntegration();
