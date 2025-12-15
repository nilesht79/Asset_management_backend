/**
 * ESCALATION ENGINE SERVICE
 * Handles SLA escalations based on configured rules
 * Triggers notifications at appropriate thresholds
 */

const { connectDB, sql } = require('../config/database');
const SlaTrackingModel = require('../models/slaTracking');
const businessHoursCalculator = require('../utils/businessHoursCalculator');

class EscalationEngine {
  /**
   * Process escalations for a single ticket
   * @param {string} ticketId - Ticket ID
   * @returns {Array} Triggered escalations
   */
  async processTicketEscalations(ticketId) {
    try {
      const pool = await connectDB();

      // Get SLA tracking with rule details
      const tracking = await SlaTrackingModel.getTracking(ticketId);
      if (!tracking || tracking.resolved_at) {
        return [];
      }

      // Update elapsed time first
      await SlaTrackingModel.updateElapsedTime(ticketId);

      // Get fresh tracking data
      const updatedTracking = await SlaTrackingModel.getTracking(ticketId);

      // Get escalation rules for this SLA rule
      const escalationResult = await pool.request()
        .input('slaRuleId', sql.UniqueIdentifier, updatedTracking.sla_rule_id)
        .query(`
          SELECT * FROM ESCALATION_RULES
          WHERE sla_rule_id = @slaRuleId AND is_active = 1
          ORDER BY escalation_level ASC
        `);

      const escalationRules = escalationResult.recordset;
      const triggeredEscalations = [];

      for (const rule of escalationRules) {
        const shouldTrigger = await this.shouldTriggerEscalation(
          rule,
          updatedTracking,
          pool
        );

        if (shouldTrigger.trigger) {
          const escalation = await this.triggerEscalation(
            rule,
            updatedTracking,
            shouldTrigger.reason,
            pool
          );
          triggeredEscalations.push(escalation);
        }
      }

      return triggeredEscalations;
    } catch (error) {
      console.error('Error processing ticket escalations:', error);
      throw error;
    }
  }

  /**
   * Check if an escalation should be triggered
   */
  async shouldTriggerEscalation(rule, tracking, pool) {
    const elapsed = tracking.business_elapsed_minutes;

    // Determine the threshold based on reference
    let thresholdMinutes;
    if (rule.reference_threshold === 'avg_tat') {
      thresholdMinutes = tracking.avg_tat_minutes;
    } else {
      thresholdMinutes = tracking.max_tat_minutes;
    }

    // Calculate trigger point
    const triggerPoint = thresholdMinutes + (rule.trigger_offset_minutes || 0);

    // Check trigger conditions
    let shouldTrigger = false;
    let reason = '';

    switch (rule.trigger_type) {
      case 'warning_zone':
        // Trigger when elapsed >= trigger point (usually before breach)
        shouldTrigger = elapsed >= triggerPoint && elapsed < thresholdMinutes;
        reason = `Warning zone: ${elapsed}/${thresholdMinutes} minutes`;
        break;

      case 'imminent_breach':
        // Trigger when very close to threshold
        const imminentThreshold = thresholdMinutes + rule.trigger_offset_minutes;
        shouldTrigger = elapsed >= imminentThreshold && elapsed < thresholdMinutes;
        reason = `Imminent breach: ${thresholdMinutes - elapsed} minutes remaining`;
        break;

      case 'breached':
        // Trigger when threshold is exceeded
        shouldTrigger = elapsed >= thresholdMinutes;
        reason = `SLA breached: ${elapsed - thresholdMinutes} minutes over`;
        break;

      case 'recurring_breach':
        // Trigger repeatedly after breach
        if (elapsed >= thresholdMinutes && rule.repeat_interval_minutes) {
          const overageMinutes = elapsed - thresholdMinutes;
          const expectedTriggers = Math.floor(overageMinutes / rule.repeat_interval_minutes);
          shouldTrigger = expectedTriggers > 0;
          reason = `Recurring breach notification: ${expectedTriggers} intervals passed`;
        }
        break;
    }

    if (!shouldTrigger) {
      return { trigger: false };
    }

    // Check if already notified for this level
    const notificationCheck = await pool.request()
      .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
      .input('escalationRuleId', sql.UniqueIdentifier, rule.escalation_rule_id)
      .query(`
        SELECT COUNT(*) AS count, MAX(repeat_count) AS max_count
        FROM ESCALATION_NOTIFICATIONS_LOG
        WHERE tracking_id = @trackingId AND escalation_rule_id = @escalationRuleId
      `);

    const existingCount = notificationCheck.recordset[0].count || 0;
    const maxCount = notificationCheck.recordset[0].max_count || 0;

    // For recurring triggers, check max repeat count
    if (rule.trigger_type === 'recurring_breach' && rule.max_repeat_count) {
      if (maxCount >= rule.max_repeat_count) {
        return { trigger: false };
      }
    } else if (existingCount > 0 && rule.trigger_type !== 'recurring_breach') {
      // Already notified for non-recurring rules
      return { trigger: false };
    }

    return { trigger: true, reason };
  }

  /**
   * Trigger an escalation
   */
  async triggerEscalation(rule, tracking, reason, pool) {
    try {
      // Get recipients
      const recipients = await this.getRecipients(rule, tracking, pool);

      // Get notification count for this rule
      const countResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('escalationRuleId', sql.UniqueIdentifier, rule.escalation_rule_id)
        .query(`
          SELECT ISNULL(MAX(repeat_count), 0) + 1 AS next_count
          FROM ESCALATION_NOTIFICATIONS_LOG
          WHERE tracking_id = @trackingId AND escalation_rule_id = @escalationRuleId
        `);

      const notificationCount = countResult.recordset[0].next_count;

      // Log the escalation
      const logQuery = `
        INSERT INTO ESCALATION_NOTIFICATIONS_LOG (
          notification_id, tracking_id, escalation_rule_id,
          escalation_level, trigger_type,
          recipients, repeat_count, delivery_status, created_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @trackingId, @escalationRuleId,
          @escalationLevel, @triggerType,
          @recipients, @notificationCount, 'pending', GETDATE()
        )
      `;

      const logResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('escalationRuleId', sql.UniqueIdentifier, rule.escalation_rule_id)
        .input('escalationLevel', sql.Int, rule.escalation_level)
        .input('triggerType', sql.NVarChar(30), rule.trigger_type)
        .input('recipients', sql.NVarChar(sql.MAX), JSON.stringify(recipients))
        .input('notificationCount', sql.Int, notificationCount)
        .query(logQuery);

      return {
        notification: logResult.recordset[0],
        rule: rule,
        recipients: recipients,
        reason: reason
      };
    } catch (error) {
      console.error('Error triggering escalation:', error);
      throw error;
    }
  }

  /**
   * Get recipients for an escalation
   */
  async getRecipients(rule, tracking, pool) {
    const recipients = [];

    try {
      // Get ticket details
      const ticketResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, tracking.ticket_id)
        .query(`
          SELECT
            t.*,
            u_eng.first_name + ' ' + u_eng.last_name AS engineer_name,
            u_eng.email AS engineer_email,
            u_coord.first_name + ' ' + u_coord.last_name AS coordinator_name,
            u_coord.email AS coordinator_email,
            u_user.first_name + ' ' + u_user.last_name AS created_for_name,
            u_user.email AS created_for_email,
            d.department_name
          FROM TICKETS t
          LEFT JOIN USER_MASTER u_eng ON t.assigned_to_engineer_id = u_eng.user_id
          LEFT JOIN USER_MASTER u_coord ON t.created_by_coordinator_id = u_coord.user_id
          LEFT JOIN USER_MASTER u_user ON t.created_by_user_id = u_user.user_id
          LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
          WHERE t.ticket_id = @ticketId
        `);

      const ticket = ticketResult.recordset[0];

      const limit = rule.number_of_recipients || 3;

      switch (rule.recipient_type) {
        case 'assigned_engineer':
          // Get the engineer assigned to this specific ticket
          if (ticket.engineer_email) {
            recipients.push({
              name: ticket.engineer_name,
              email: ticket.engineer_email,
              type: 'engineer'
            });
          }
          break;

        case 'coordinator':
          // First add the ticket's coordinator if exists
          if (ticket.coordinator_email) {
            recipients.push({
              name: ticket.coordinator_name,
              email: ticket.coordinator_email,
              type: 'coordinator'
            });
          }
          // Then add other coordinators up to the limit
          const coordResult = await pool.request()
            .input('limit', sql.Int, limit)
            .query(`
              SELECT TOP (@limit) first_name + ' ' + last_name AS name, email
              FROM USER_MASTER
              WHERE role = 'coordinator' AND is_active = 1
              ORDER BY NEWID()
            `);
          for (const coord of coordResult.recordset) {
            if (!recipients.find(r => r.email === coord.email) && recipients.length < limit) {
              recipients.push({ ...coord, type: 'coordinator' });
            }
          }
          break;

        case 'it_head':
          // Get IT Head users
          const itHeadResult = await pool.request()
            .input('limit', sql.Int, limit)
            .query(`
              SELECT TOP (@limit) first_name + ' ' + last_name AS name, email
              FROM USER_MASTER
              WHERE role = 'it_head' AND is_active = 1
              ORDER BY NEWID()
            `);
          for (const itHead of itHeadResult.recordset) {
            recipients.push({ ...itHead, type: 'it_head' });
          }
          break;

        case 'department_head':
          // Get Department Head users (prioritize same department)
          const dhResult = await pool.request()
            .input('departmentId', sql.UniqueIdentifier, ticket.department_id)
            .input('limit', sql.Int, limit)
            .query(`
              SELECT TOP (@limit) first_name + ' ' + last_name AS name, email
              FROM USER_MASTER
              WHERE role = 'department_head' AND is_active = 1
                AND (department_id = @departmentId OR department_id IS NULL)
              ORDER BY CASE WHEN department_id = @departmentId THEN 0 ELSE 1 END, NEWID()
            `);
          for (const dh of dhResult.recordset) {
            recipients.push({ ...dh, type: 'department_head' });
          }
          break;

        case 'admin':
          // Get Admin users
          const adminResult = await pool.request()
            .input('limit', sql.Int, limit)
            .query(`
              SELECT TOP (@limit) first_name + ' ' + last_name AS name, email
              FROM USER_MASTER
              WHERE role = 'admin' AND is_active = 1
              ORDER BY NEWID()
            `);
          for (const admin of adminResult.recordset) {
            recipients.push({ ...admin, type: 'admin' });
          }
          break;

        case 'superadmin':
          // Get Super Admin users
          const superadminResult = await pool.request()
            .input('limit', sql.Int, limit)
            .query(`
              SELECT TOP (@limit) first_name + ' ' + last_name AS name, email
              FROM USER_MASTER
              WHERE role = 'superadmin' AND is_active = 1
              ORDER BY NEWID()
            `);
          for (const sa of superadminResult.recordset) {
            recipients.push({ ...sa, type: 'superadmin' });
          }
          break;

        case 'custom_role':
          // Get users by custom role specified in recipient_role field
          if (rule.recipient_role) {
            const customResult = await pool.request()
              .input('role', sql.NVarChar(50), rule.recipient_role)
              .input('limit', sql.Int, limit)
              .query(`
                SELECT TOP (@limit) first_name + ' ' + last_name AS name, email
                FROM USER_MASTER
                WHERE role = @role AND is_active = 1
                ORDER BY NEWID()
              `);
            for (const user of customResult.recordset) {
              recipients.push({ ...user, type: rule.recipient_role });
            }
          }
          break;

        case 'custom_designation':
          // Get users by designation specified in recipient_role field
          if (rule.recipient_role) {
            const designationResult = await pool.request()
              .input('designation', sql.NVarChar(100), rule.recipient_role)
              .input('departmentId', sql.UniqueIdentifier, ticket.department_id)
              .input('limit', sql.Int, limit)
              .query(`
                SELECT TOP (@limit) first_name + ' ' + last_name AS name, email, designation
                FROM USER_MASTER
                WHERE designation = @designation AND is_active = 1
                ORDER BY CASE WHEN department_id = @departmentId THEN 0 ELSE 1 END, NEWID()
              `);
            for (const user of designationResult.recordset) {
              recipients.push({ ...user, type: user.designation });
            }
          }
          break;
      }

      return recipients;
    } catch (error) {
      console.error('Error getting recipients:', error);
      return recipients;
    }
  }

  /**
   * Process all pending escalations (for background job)
   */
  async processAllPendingEscalations() {
    try {
      const pool = await connectDB();

      // Get all active tickets with SLA tracking
      const ticketsResult = await pool.request()
        .query(`
          SELECT DISTINCT tst.ticket_id
          FROM TICKET_SLA_TRACKING tst
          INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
          WHERE tst.resolved_at IS NULL
            AND tst.is_paused = 0
            AND t.status NOT IN ('closed', 'cancelled')
        `);

      const results = [];

      for (const ticket of ticketsResult.recordset) {
        try {
          const escalations = await this.processTicketEscalations(ticket.ticket_id);
          if (escalations.length > 0) {
            results.push({
              ticket_id: ticket.ticket_id,
              escalations_triggered: escalations.length,
              escalations: escalations
            });
          }
        } catch (err) {
          results.push({
            ticket_id: ticket.ticket_id,
            error: err.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error processing all pending escalations:', error);
      throw error;
    }
  }

  /**
   * Get escalation history for a ticket
   */
  async getTicketEscalationHistory(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          enl.*,
          er.escalation_type,
          er.notification_template,
          er.recipient_type,
          er.reference_threshold
        FROM ESCALATION_NOTIFICATIONS_LOG enl
        INNER JOIN TICKET_SLA_TRACKING tst ON enl.tracking_id = tst.tracking_id
        INNER JOIN ESCALATION_RULES er ON enl.escalation_rule_id = er.escalation_rule_id
        WHERE tst.ticket_id = @ticketId
        ORDER BY enl.created_at DESC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset.map(row => ({
        ...row,
        recipients: JSON.parse(row.recipients || '[]')
      }));
    } catch (error) {
      console.error('Error getting escalation history:', error);
      throw error;
    }
  }

  /**
   * Update notification status
   */
  async updateNotificationStatus(notificationId, status, sentAt = null, errorMessage = null) {
    try {
      const pool = await connectDB();

      const query = `
        UPDATE ESCALATION_NOTIFICATIONS_LOG SET
          delivery_status = @status,
          notification_sent_at = @sentAt,
          error_message = @errorMessage
        WHERE notification_id = @notificationId
      `;

      await pool.request()
        .input('notificationId', sql.UniqueIdentifier, notificationId)
        .input('status', sql.NVarChar(20), status)
        .input('sentAt', sql.DateTime, sentAt)
        .input('errorMessage', sql.NVarChar(500), errorMessage)
        .query(query);

      return true;
    } catch (error) {
      console.error('Error updating notification status:', error);
      throw error;
    }
  }

  /**
   * Get pending notifications to be sent
   */
  async getPendingNotifications() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          enl.*,
          tst.ticket_id,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority,
          t.status AS ticket_status,
          sr.rule_name AS sla_rule_name,
          tst.business_elapsed_minutes,
          sr.max_tat_minutes,
          er.notification_template,
          er.include_ticket_details
        FROM ESCALATION_NOTIFICATIONS_LOG enl
        INNER JOIN TICKET_SLA_TRACKING tst ON enl.tracking_id = tst.tracking_id
        INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        INNER JOIN ESCALATION_RULES er ON enl.escalation_rule_id = er.escalation_rule_id
        WHERE enl.delivery_status = 'pending'
        ORDER BY enl.created_at ASC
      `;

      const result = await pool.request().query(query);

      return result.recordset.map(row => ({
        ...row,
        recipients: JSON.parse(row.recipients || '[]')
      }));
    } catch (error) {
      console.error('Error getting pending notifications:', error);
      throw error;
    }
  }
}

module.exports = new EscalationEngine();
