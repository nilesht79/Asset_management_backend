/**
 * IN-APP NOTIFICATION SERVICE
 * Creates in-app notifications for SLA escalations and other events
 */

const NotificationModel = require('../models/notification');
const businessHoursCalculator = require('../utils/businessHoursCalculator');

class InAppNotificationService {
  /**
   * Create in-app notification for SLA event
   * @param {Object} notificationData - Notification data
   * @returns {Object} Created notification(s)
   */
  async createSlaNotification(notificationData) {
    const {
      user_ids, // Array of user IDs to notify
      ticket_id,
      ticket_number,
      ticket_title,
      priority,
      trigger_type,
      escalation_level,
      elapsed_business_minutes,
      max_tat_minutes,
      sla_rule_name
    } = notificationData;

    try {
      // Build notification content based on trigger type
      const content = this.buildSlaNotificationContent({
        ticket_number,
        ticket_title,
        priority,
        trigger_type,
        escalation_level,
        elapsed_business_minutes,
        max_tat_minutes,
        sla_rule_name
      });

      // Create notification for each user
      const notifications = await NotificationModel.createBulkNotifications(
        user_ids,
        {
          ticket_id,
          notification_type: trigger_type,
          title: content.title,
          message: content.message,
          priority: content.notificationPriority,
          related_data: {
            ticket_number,
            ticket_title,
            escalation_level,
            sla_rule_name,
            elapsed_minutes: elapsed_business_minutes,
            max_minutes: max_tat_minutes
          }
        }
      );

      console.log(`Created ${notifications.length} in-app notification(s) for ticket ${ticket_number}`);

      return notifications;
    } catch (error) {
      console.error('Error creating SLA notification:', error);
      throw error;
    }
  }

  /**
   * Build notification content based on SLA trigger type
   * @param {Object} data - SLA data
   * @returns {Object} Notification content
   */
  buildSlaNotificationContent(data) {
    const {
      ticket_number,
      ticket_title,
      priority,
      trigger_type,
      escalation_level,
      elapsed_business_minutes,
      max_tat_minutes,
      sla_rule_name
    } = data;

    const formattedElapsed = businessHoursCalculator.formatDuration(elapsed_business_minutes);
    const formattedMax = businessHoursCalculator.formatDuration(max_tat_minutes);
    const remaining = max_tat_minutes - elapsed_business_minutes;
    const formattedRemaining = remaining > 0
      ? businessHoursCalculator.formatDuration(remaining)
      : `${businessHoursCalculator.formatDuration(Math.abs(remaining))} overdue`;

    let title = '';
    let message = '';
    let notificationPriority = 'medium';

    switch (trigger_type) {
      case 'warning_zone':
        title = `SLA Warning: ${ticket_number}`;
        message = `Ticket "${ticket_title}" is approaching SLA threshold. ${formattedRemaining} remaining.`;
        notificationPriority = 'medium';
        break;

      case 'imminent_breach':
        title = `Urgent: ${ticket_number} - Imminent SLA Breach`;
        message = `Ticket "${ticket_title}" is about to breach SLA! ${formattedRemaining} remaining. Immediate action required.`;
        notificationPriority = 'high';
        break;

      case 'breached':
        title = `SLA BREACHED: ${ticket_number}`;
        message = `Ticket "${ticket_title}" has breached its SLA deadline by ${formattedRemaining}. Escalation Level ${escalation_level}.`;
        notificationPriority = 'critical';
        break;

      case 'recurring_breach':
        title = `SLA Breach Reminder: ${ticket_number}`;
        message = `Ticket "${ticket_title}" remains unresolved and breached. Overdue by ${formattedRemaining}.`;
        notificationPriority = 'high';
        break;

      default:
        title = `SLA Alert: ${ticket_number}`;
        message = `SLA alert for ticket "${ticket_title}". Please review.`;
        notificationPriority = 'medium';
    }

    return {
      title,
      message,
      notificationPriority
    };
  }

  /**
   * Create notification for ticket assignment
   * @param {Object} data - Assignment data
   */
  async createTicketAssignmentNotification(data) {
    const { engineer_id, ticket_id, ticket_number, ticket_title, assigned_by_name } = data;

    try {
      await NotificationModel.createNotification({
        user_id: engineer_id,
        ticket_id,
        notification_type: 'ticket_assigned',
        title: `New Ticket Assigned: ${ticket_number}`,
        message: `You have been assigned to ticket "${ticket_title}" by ${assigned_by_name}.`,
        priority: 'medium',
        related_data: {
          ticket_number,
          ticket_title,
          assigned_by: assigned_by_name
        }
      });

      console.log(`Created ticket assignment notification for ${ticket_number}`);
    } catch (error) {
      console.error('Error creating assignment notification:', error);
      // Don't throw - notification failure shouldn't block assignment
    }
  }

  /**
   * Create notification for ticket status change
   * @param {Object} data - Status change data
   */
  async createTicketStatusNotification(data) {
    const { user_id, ticket_id, ticket_number, old_status, new_status } = data;

    try {
      let title = '';
      let message = '';
      let notificationPriority = 'low';

      if (new_status === 'closed') {
        title = `Ticket Closed: ${ticket_number}`;
        message = `Your ticket has been closed.`;
        notificationPriority = 'medium';
      } else if (new_status === 'resolved') {
        title = `Ticket Resolved: ${ticket_number}`;
        message = `Your ticket has been resolved. Please review.`;
        notificationPriority = 'medium';
      } else if (new_status === 'pending_closure') {
        title = `Ticket Pending Closure: ${ticket_number}`;
        message = `Your ticket is pending closure approval.`;
        notificationPriority = 'low';
      } else {
        title = `Ticket Status Updated: ${ticket_number}`;
        message = `Status changed from ${old_status} to ${new_status}.`;
        notificationPriority = 'low';
      }

      await NotificationModel.createNotification({
        user_id,
        ticket_id,
        notification_type: 'status_change',
        title,
        message,
        priority: notificationPriority,
        related_data: {
          ticket_number,
          old_status,
          new_status
        }
      });

      console.log(`Created status change notification for ${ticket_number}`);
    } catch (error) {
      console.error('Error creating status notification:', error);
      // Don't throw
    }
  }

  /**
   * Create notification for ticket comment/update
   * @param {Object} data - Comment data
   */
  async createTicketCommentNotification(data) {
    const { user_id, ticket_id, ticket_number, comment_by_name, comment_preview } = data;

    try {
      await NotificationModel.createNotification({
        user_id,
        ticket_id,
        notification_type: 'comment_added',
        title: `New Comment on ${ticket_number}`,
        message: `${comment_by_name} commented: "${comment_preview}"`,
        priority: 'low',
        related_data: {
          ticket_number,
          commented_by: comment_by_name
        }
      });

      console.log(`Created comment notification for ${ticket_number}`);
    } catch (error) {
      console.error('Error creating comment notification:', error);
      // Don't throw
    }
  }
}

module.exports = new InAppNotificationService();
