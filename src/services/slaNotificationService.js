/**
 * SLA NOTIFICATION SERVICE
 * Handles sending notifications for SLA escalations
 * Supports email notifications via Gmail or SMTP (configured in database)
 */

const { connectDB, sql } = require('../config/database');
const escalationEngine = require('./escalationEngine');
const businessHoursCalculator = require('../utils/businessHoursCalculator');
const emailService = require('./emailService');

class SlaNotificationService {
  constructor() {
    // Email service is now managed via database configuration
    // No need for environment variable - configuration is in EMAIL_CONFIGURATION table
  }

  /**
   * Process and send all pending notifications
   */
  async processPendingNotifications() {
    try {
      const pendingNotifications = await escalationEngine.getPendingNotifications();
      const results = [];

      for (const notification of pendingNotifications) {
        try {
          const result = await this.sendNotification(notification);
          results.push(result);
        } catch (error) {
          console.error(`Error sending notification ${notification.notification_id}:`, error);
          await escalationEngine.updateNotificationStatus(
            notification.notification_id,
            'failed',
            null,
            error.message
          );
          results.push({
            notification_id: notification.notification_id,
            status: 'failed',
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error processing pending notifications:', error);
      throw error;
    }
  }

  /**
   * Send a single notification
   */
  async sendNotification(notification) {
    const {
      notification_id,
      ticket_id,
      ticket_number,
      ticket_title,
      priority,
      escalation_level,
      trigger_type,
      recipients,
      notification_template,
      include_ticket_details,
      business_elapsed_minutes,
      max_tat_minutes,
      sla_rule_name
    } = notification;

    // Build notification content
    const content = this.buildNotificationContent({
      ticket_number,
      ticket_title,
      priority,
      escalation_level,
      trigger_type,
      elapsed_business_minutes: business_elapsed_minutes,
      max_tat_minutes,
      sla_rule_name,
      include_ticket_details
    });

    // Send to each recipient using email service
    const sendResults = [];

    for (const recipient of recipients) {
      try {
        // Use the centralized email service
        const result = await emailService.sendEmail(
          recipient.email,
          content.subject,
          content.body
        );

        if (result.success) {
          sendResults.push({
            email: recipient.email,
            name: recipient.name,
            status: 'sent',
            messageId: result.messageId
          });
        } else {
          // Email service returned failure but didn't throw
          sendResults.push({
            email: recipient.email,
            name: recipient.name,
            status: result.reason === 'Email service not configured or disabled' ? 'logged' : 'failed',
            error: result.reason || result.error
          });
        }
      } catch (err) {
        sendResults.push({
          email: recipient.email,
          name: recipient.name,
          status: 'failed',
          error: err.message
        });
      }
    }

    // Update notification status
    const allSent = sendResults.every(r => r.status === 'sent');
    await escalationEngine.updateNotificationStatus(
      notification_id,
      allSent ? 'sent' : 'partial',
      new Date(),
      allSent ? null : 'Some recipients failed'
    );

    // Log notification to database
    await this.logNotificationDetails(notification_id, sendResults);

    return {
      notification_id,
      ticket_number,
      status: allSent ? 'sent' : 'partial',
      recipients_count: recipients.length,
      sent_count: sendResults.filter(r => r.status === 'sent').length,
      failed_count: sendResults.filter(r => r.status === 'failed').length
    };
  }

  /**
   * Build notification content based on template
   */
  buildNotificationContent(data) {
    const {
      ticket_number,
      ticket_title,
      priority,
      escalation_level,
      trigger_type,
      elapsed_business_minutes,
      max_tat_minutes,
      sla_rule_name,
      include_ticket_details
    } = data;

    const formattedElapsed = businessHoursCalculator.formatDuration(elapsed_business_minutes);
    const formattedMax = businessHoursCalculator.formatDuration(max_tat_minutes);
    const remaining = max_tat_minutes - elapsed_business_minutes;
    const formattedRemaining = remaining > 0
      ? businessHoursCalculator.formatDuration(remaining)
      : businessHoursCalculator.formatDuration(Math.abs(remaining)) + ' overdue';

    let subject = '';
    let body = '';

    switch (trigger_type) {
      case 'warning_zone':
        subject = `[SLA Warning] Ticket ${ticket_number} - Action Required`;
        body = `
SLA WARNING NOTIFICATION
========================

Ticket ${ticket_number} is approaching its SLA threshold.

SLA Rule: ${sla_rule_name}
Elapsed Time: ${formattedElapsed}
SLA Deadline: ${formattedMax}
Time Remaining: ${formattedRemaining}

Please take action to resolve this ticket promptly.
`;
        break;

      case 'imminent_breach':
        subject = `[URGENT] Ticket ${ticket_number} - Imminent SLA Breach`;
        body = `
URGENT: IMMINENT SLA BREACH
===========================

Ticket ${ticket_number} is about to breach its SLA!

SLA Rule: ${sla_rule_name}
Elapsed Time: ${formattedElapsed}
SLA Deadline: ${formattedMax}
Time Remaining: ${formattedRemaining}

IMMEDIATE ACTION REQUIRED to prevent SLA breach.
`;
        break;

      case 'breached':
        subject = `[SLA BREACHED] Ticket ${ticket_number} - Escalation Level ${escalation_level}`;
        body = `
SLA BREACH NOTIFICATION
=======================

Ticket ${ticket_number} has BREACHED its SLA!

SLA Rule: ${sla_rule_name}
Elapsed Time: ${formattedElapsed}
SLA Deadline: ${formattedMax}
Overage: ${formattedRemaining}
Escalation Level: ${escalation_level}

This ticket requires immediate attention and resolution.
`;
        break;

      case 'recurring_breach':
        subject = `[SLA BREACH REMINDER] Ticket ${ticket_number} - Still Unresolved`;
        body = `
SLA BREACH REMINDER
==================

Ticket ${ticket_number} remains in breach status.

SLA Rule: ${sla_rule_name}
Elapsed Time: ${formattedElapsed}
SLA Deadline: ${formattedMax}
Overage: ${formattedRemaining}
Escalation Level: ${escalation_level}

This is a reminder that this ticket is still pending resolution.
`;
        break;

      default:
        subject = `[SLA Alert] Ticket ${ticket_number}`;
        body = `SLA alert for ticket ${ticket_number}`;
    }

    // Add ticket details if requested
    if (include_ticket_details) {
      body += `
---
Ticket Details:
- Number: ${ticket_number}
- Title: ${ticket_title}
- Priority: ${priority?.toUpperCase() || 'N/A'}
`;
    }

    body += `
---
This is an automated notification from the Asset Management System.
Please do not reply to this email.
`;

    return { subject, body };
  }

  /**
   * Send email using the centralized email service
   */
  async sendEmail(to, subject, body) {
    return emailService.sendEmail(to, subject, body);
  }

  /**
   * Log notification details to database
   */
  async logNotificationDetails(notificationId, sendResults) {
    try {
      const pool = await connectDB();

      await pool.request()
        .input('notificationId', sql.UniqueIdentifier, notificationId)
        .input('details', sql.NVarChar(sql.MAX), JSON.stringify(sendResults))
        .query(`
          UPDATE ESCALATION_NOTIFICATIONS_LOG
          SET notification_details = @details
          WHERE notification_id = @notificationId
        `);
    } catch (error) {
      console.error('Error logging notification details:', error);
    }
  }

  /**
   * Send immediate notification (for critical escalations)
   */
  async sendImmediateNotification(ticketId, notificationType, customMessage = null) {
    try {
      const pool = await connectDB();

      // Get ticket and SLA info
      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT
            t.ticket_number,
            t.title,
            t.priority,
            t.assigned_to_engineer_id,
            tst.business_elapsed_minutes,
            sr.max_tat_minutes,
            sr.rule_name,
            u_eng.email AS engineer_email,
            u_eng.first_name + ' ' + u_eng.last_name AS engineer_name
          FROM TICKETS t
          LEFT JOIN TICKET_SLA_TRACKING tst ON t.ticket_id = tst.ticket_id
          LEFT JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
          LEFT JOIN USER_MASTER u_eng ON t.assigned_to_engineer_id = u_eng.user_id
          WHERE t.ticket_id = @ticketId
        `);

      if (result.recordset.length === 0) {
        throw new Error('Ticket not found');
      }

      const ticket = result.recordset[0];

      const content = this.buildNotificationContent({
        ticket_number: ticket.ticket_number,
        ticket_title: ticket.title,
        priority: ticket.priority,
        escalation_level: 0,
        trigger_type: notificationType,
        elapsed_business_minutes: ticket.business_elapsed_minutes || 0,
        max_tat_minutes: ticket.max_tat_minutes || 480,
        sla_rule_name: ticket.rule_name || 'Default SLA',
        include_ticket_details: true
      });

      if (customMessage) {
        content.body = customMessage + '\n\n' + content.body;
      }

      if (ticket.engineer_email) {
        await this.sendEmail(ticket.engineer_email, content.subject, content.body);
      }

      return {
        sent: true,
        ticket_number: ticket.ticket_number,
        recipient: ticket.engineer_email
      };
    } catch (error) {
      console.error('Error sending immediate notification:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      if (filters.startDate) {
        whereClause += ` AND enl.created_at >= '${filters.startDate}'`;
      }
      if (filters.endDate) {
        whereClause += ` AND enl.created_at <= '${filters.endDate}'`;
      }

      const query = `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN delivery_status = 'sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN delivery_status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN trigger_type = 'warning_zone' THEN 1 ELSE 0 END) AS warning_triggered,
          SUM(CASE WHEN trigger_type = 'imminent_breach' THEN 1 ELSE 0 END) AS imminent_triggered,
          SUM(CASE WHEN trigger_type = 'breached' THEN 1 ELSE 0 END) AS breach_triggered,
          SUM(CASE WHEN trigger_type = 'recurring_breach' THEN 1 ELSE 0 END) AS recurring_triggered
        FROM ESCALATION_NOTIFICATIONS_LOG enl
        ${whereClause}
      `;

      const result = await pool.request().query(query);
      return result.recordset[0];
    } catch (error) {
      console.error('Error getting notification stats:', error);
      throw error;
    }
  }
}

module.exports = new SlaNotificationService();
