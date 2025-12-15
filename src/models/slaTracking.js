/**
 * SLA TRACKING MODEL
 * Handles all database operations for ticket SLA tracking
 */

const { connectDB, sql } = require('../config/database');
const businessHoursCalculator = require('../utils/businessHoursCalculator');
const slaMatchingEngine = require('../services/slaMatchingEngine');

class SlaTrackingModel {
  /**
   * Initialize SLA tracking for a ticket
   * @param {string} ticketId - Ticket ID
   * @param {Object} ticketContext - Context for SLA matching
   */
  static async initializeTracking(ticketId, ticketContext) {
    try {
      const pool = await connectDB();

      // Check if tracking already exists
      const existingResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query('SELECT tracking_id FROM TICKET_SLA_TRACKING WHERE ticket_id = @ticketId');

      if (existingResult.recordset.length > 0) {
        throw new Error('SLA tracking already exists for this ticket');
      }

      // Find matching SLA rule
      const matchResult = await slaMatchingEngine.findMatchingRule(ticketContext);
      const rule = matchResult.rule;

      // Calculate deadlines
      const now = new Date();
      const minDeadline = await businessHoursCalculator.calculateDeadline(
        now,
        rule.min_tat_minutes,
        rule.business_hours_schedule_id,
        rule.holiday_calendar_id
      );
      const avgDeadline = await businessHoursCalculator.calculateDeadline(
        now,
        rule.avg_tat_minutes,
        rule.business_hours_schedule_id,
        rule.holiday_calendar_id
      );
      const maxDeadline = await businessHoursCalculator.calculateDeadline(
        now,
        rule.max_tat_minutes,
        rule.business_hours_schedule_id,
        rule.holiday_calendar_id
      );

      // Parse pause conditions
      let pauseConditions = {};
      try {
        pauseConditions = JSON.parse(rule.pause_conditions || '{}');
      } catch (e) {
        pauseConditions = {};
      }

      // Create tracking record
      const query = `
        INSERT INTO TICKET_SLA_TRACKING (
          tracking_id, ticket_id, sla_rule_id, sla_start_time,
          min_target_time, avg_target_time, max_target_time,
          business_elapsed_minutes, total_paused_minutes,
          is_paused, pause_started_at, sla_status,
          created_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @ticketId, @slaRuleId, @slaStartTime,
          @minDeadline, @avgDeadline, @maxDeadline,
          0, 0,
          0, NULL, 'on_track',
          GETDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('slaRuleId', sql.UniqueIdentifier, rule.rule_id)
        .input('slaStartTime', sql.DateTime, now)
        .input('minDeadline', sql.DateTime, minDeadline)
        .input('avgDeadline', sql.DateTime, avgDeadline)
        .input('maxDeadline', sql.DateTime, maxDeadline)
        .query(query);

      return {
        tracking: result.recordset[0],
        rule: rule,
        escalation_rules: matchResult.escalation_rules
      };
    } catch (error) {
      console.error('Error initializing SLA tracking:', error);
      throw error;
    }
  }

  /**
   * Get SLA tracking for a ticket
   */
  static async getTracking(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          tst.*,
          sr.rule_name,
          sr.description AS rule_description,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.business_hours_schedule_id,
          sr.holiday_calendar_id,
          sr.allow_pause_resume,
          sr.pause_conditions,
          bhs.schedule_name AS business_hours_name,
          hc.calendar_name AS holiday_calendar_name
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        LEFT JOIN BUSINESS_HOURS_SCHEDULES bhs ON sr.business_hours_schedule_id = bhs.schedule_id
        LEFT JOIN HOLIDAY_CALENDARS hc ON sr.holiday_calendar_id = hc.calendar_id
        WHERE tst.ticket_id = @ticketId
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      if (result.recordset.length === 0) {
        return null;
      }

      return result.recordset[0];
    } catch (error) {
      console.error('Error getting SLA tracking:', error);
      throw error;
    }
  }

  /**
   * Update elapsed time for a ticket
   */
  static async updateElapsedTime(ticketId) {
    try {
      const pool = await connectDB();

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        throw new Error('SLA tracking not found for ticket');
      }

      // If ticket is closed or SLA stopped, don't update
      if (tracking.resolved_at) {
        return tracking;
      }

      // Get pause periods from action log (pair pause/resume actions)
      const pauseResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .query(`
          SELECT
            p.action_at as pause_start,
            r.action_at as pause_end
          FROM TICKET_SLA_PAUSE_LOG p
          LEFT JOIN TICKET_SLA_PAUSE_LOG r ON p.tracking_id = r.tracking_id
            AND r.action = 'resumed'
            AND r.action_at > p.action_at
            AND NOT EXISTS (
              SELECT 1 FROM TICKET_SLA_PAUSE_LOG p2
              WHERE p2.tracking_id = p.tracking_id
                AND p2.action = 'paused'
                AND p2.action_at > p.action_at
                AND p2.action_at < r.action_at
            )
          WHERE p.tracking_id = @trackingId
            AND p.action = 'paused'
            AND r.action_at IS NOT NULL
        `);

      const pausePeriods = pauseResult.recordset;

      // Calculate elapsed business minutes
      const endTime = tracking.is_paused ? new Date(tracking.pause_started_at) : new Date();
      const elapsedMinutes = await businessHoursCalculator.calculateElapsedMinutes(
        new Date(tracking.sla_start_time),
        endTime,
        tracking.business_hours_schedule_id,
        tracking.holiday_calendar_id,
        pausePeriods
      );

      // Calculate SLA status
      const slaStatus = businessHoursCalculator.calculateSlaStatus(
        elapsedMinutes,
        tracking.min_tat_minutes,
        tracking.avg_tat_minutes,
        tracking.max_tat_minutes
      );

      // Update tracking record
      const updateQuery = `
        UPDATE TICKET_SLA_TRACKING SET
          business_elapsed_minutes = @elapsedMinutes,
          sla_status = @slaStatus,
          last_calculated_at = GETDATE(),
          updated_at = GETDATE()
        OUTPUT INSERTED.*
        WHERE tracking_id = @trackingId
      `;

      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('elapsedMinutes', sql.Int, elapsedMinutes)
        .input('slaStatus', sql.NVarChar(20), slaStatus.status)
        .query(updateQuery);

      // Return full tracking data with SLA rule details
      const fullTracking = await this.getTracking(ticketId);
      return {
        ...fullTracking,
        sla_status_details: slaStatus
      };
    } catch (error) {
      console.error('Error updating elapsed time:', error);
      throw error;
    }
  }

  /**
   * Pause SLA timer
   */
  static async pauseTimer(ticketId, reason, pausedBy) {
    try {
      const pool = await connectDB();

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        throw new Error('SLA tracking not found for ticket');
      }

      if (tracking.is_paused) {
        throw new Error('SLA timer is already paused');
      }

      if (!tracking.allow_pause_resume) {
        throw new Error('Pause/resume is not allowed for this SLA rule');
      }

      const now = new Date();

      // Update tracking to paused
      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('currentPauseStart', sql.DateTime, now)
        .input('pauseReason', sql.NVarChar(500), reason)
        .query(`
          UPDATE TICKET_SLA_TRACKING SET
            is_paused = 1,
            pause_started_at = @currentPauseStart,
            current_pause_reason = @pauseReason,
            updated_at = GETDATE()
          WHERE tracking_id = @trackingId
        `);

      // Create pause log entry
      const logQuery = `
        INSERT INTO TICKET_SLA_PAUSE_LOG (
          log_id, tracking_id, action, reason, action_at, created_by
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @trackingId, 'paused', @pauseReason, GETDATE(), @pausedBy
        )
      `;

      const logResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('pauseReason', sql.NVarChar(500), reason)
        .input('pausedBy', sql.UniqueIdentifier, pausedBy)
        .query(logQuery);

      return logResult.recordset[0];
    } catch (error) {
      console.error('Error pausing SLA timer:', error);
      throw error;
    }
  }

  /**
   * Resume SLA timer
   */
  static async resumeTimer(ticketId, resumedBy) {
    try {
      const pool = await connectDB();

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        throw new Error('SLA tracking not found for ticket');
      }

      if (!tracking.is_paused) {
        throw new Error('SLA timer is not paused');
      }

      const now = new Date();
      const pauseStart = new Date(tracking.pause_started_at);
      const pausedMinutes = Math.round((now - pauseStart) / (1000 * 60));

      // Update tracking to resumed
      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('totalPausedMinutes', sql.Int, tracking.total_paused_minutes + pausedMinutes)
        .query(`
          UPDATE TICKET_SLA_TRACKING SET
            is_paused = 0,
            pause_started_at = NULL,
            current_pause_reason = NULL,
            total_paused_minutes = @totalPausedMinutes,
            updated_at = GETDATE()
          WHERE tracking_id = @trackingId
        `);

      // Create resume log entry
      const logQuery = `
        INSERT INTO TICKET_SLA_PAUSE_LOG (
          log_id, tracking_id, action, reason, action_at, paused_duration_minutes, created_by
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @trackingId, 'resumed', 'Timer resumed', GETDATE(), @pausedMinutes, @resumedBy
        )
      `;

      const logResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('pausedMinutes', sql.Int, pausedMinutes)
        .input('resumedBy', sql.UniqueIdentifier, resumedBy)
        .query(logQuery);

      return logResult.recordset[0];
    } catch (error) {
      console.error('Error resuming SLA timer:', error);
      throw error;
    }
  }

  /**
   * Stop SLA tracking (ticket closed)
   */
  static async stopTracking(ticketId, finalStatus) {
    try {
      const pool = await connectDB();

      // First update elapsed time
      await this.updateElapsedTime(ticketId);

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        return null;
      }

      // If paused, close the pause first
      if (tracking.is_paused) {
        await this.resumeTimer(ticketId, null);
      }

      // Stop tracking
      const query = `
        UPDATE TICKET_SLA_TRACKING SET
          resolved_at = GETDATE(),
          final_status = @finalStatus,
          updated_at = GETDATE()
        OUTPUT INSERTED.*
        WHERE tracking_id = @trackingId
      `;

      const result = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('finalStatus', sql.NVarChar(20), finalStatus || tracking.sla_status)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error stopping SLA tracking:', error);
      throw error;
    }
  }

  /**
   * Get pause history for a ticket
   */
  static async getPauseHistory(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          pl.*,
          u.first_name + ' ' + u.last_name AS action_by_name
        FROM TICKET_SLA_PAUSE_LOG pl
        INNER JOIN TICKET_SLA_TRACKING tst ON pl.tracking_id = tst.tracking_id
        LEFT JOIN USER_MASTER u ON pl.created_by = u.user_id
        WHERE tst.ticket_id = @ticketId
        ORDER BY pl.action_at DESC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error getting pause history:', error);
      throw error;
    }
  }

  /**
   * Get tickets approaching SLA breach
   */
  static async getTicketsApproachingBreach(thresholdMinutes = 30) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          tst.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority,
          t.status,
          t.assigned_to_engineer_id,
          sr.rule_name,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.max_tat_minutes - tst.business_elapsed_minutes AS remaining_minutes,
          CASE WHEN sr.max_tat_minutes > 0
            THEN CAST(tst.business_elapsed_minutes * 100.0 / sr.max_tat_minutes AS INT)
            ELSE 0 END AS percent_used,
          u.first_name + ' ' + u.last_name AS assigned_to_name,
          u.email AS assigned_engineer_email
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        WHERE tst.resolved_at IS NULL
          AND tst.is_paused = 0
          AND t.status NOT IN ('closed', 'cancelled')
          AND (sr.max_tat_minutes - tst.business_elapsed_minutes) <= @thresholdMinutes
          AND (sr.max_tat_minutes - tst.business_elapsed_minutes) > 0
        ORDER BY (sr.max_tat_minutes - tst.business_elapsed_minutes) ASC
      `;

      const result = await pool.request()
        .input('thresholdMinutes', sql.Int, thresholdMinutes)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error getting tickets approaching breach:', error);
      throw error;
    }
  }

  /**
   * Get breached tickets
   */
  static async getBreachedTickets() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          tst.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority,
          t.status,
          t.assigned_to_engineer_id,
          sr.rule_name,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          tst.business_elapsed_minutes - sr.max_tat_minutes AS overdue_minutes,
          tst.breach_triggered_at AS breached_at,
          ISNULL((SELECT MAX(escalation_level) FROM ESCALATION_NOTIFICATIONS_LOG el WHERE el.tracking_id = tst.tracking_id), 0) AS escalation_level,
          u.first_name + ' ' + u.last_name AS assigned_to_name,
          u.email AS assigned_engineer_email
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        WHERE tst.resolved_at IS NULL
          AND t.status NOT IN ('closed', 'cancelled')
          AND tst.business_elapsed_minutes >= sr.max_tat_minutes
        ORDER BY (tst.business_elapsed_minutes - sr.max_tat_minutes) DESC
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error getting breached tickets:', error);
      throw error;
    }
  }

  /**
   * Get SLA metrics/statistics
   */
  static async getSlaMetrics(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      if (filters.startDate) {
        whereClause += ` AND tst.sla_start_time >= '${filters.startDate}'`;
      }
      if (filters.endDate) {
        whereClause += ` AND tst.sla_start_time <= '${filters.endDate}'`;
      }
      if (filters.ruleId) {
        whereClause += ` AND tst.sla_rule_id = '${filters.ruleId}'`;
      }

      const query = `
        SELECT
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN tst.sla_status = 'on_track' THEN 1 ELSE 0 END) AS on_track_count,
          SUM(CASE WHEN tst.sla_status = 'warning' THEN 1 ELSE 0 END) AS warning_count,
          SUM(CASE WHEN tst.sla_status = 'critical' THEN 1 ELSE 0 END) AS critical_count,
          SUM(CASE WHEN tst.sla_status = 'breached' THEN 1 ELSE 0 END) AS breached_count,
          SUM(CASE WHEN tst.is_paused = 1 THEN 1 ELSE 0 END) AS paused_count,
          SUM(CASE WHEN tst.resolved_at IS NOT NULL AND tst.final_status != 'breached' THEN 1 ELSE 0 END) AS resolved_within_sla,
          AVG(tst.business_elapsed_minutes) AS avg_resolution_minutes,
          AVG(tst.total_paused_minutes) AS avg_paused_minutes,
          CAST(SUM(CASE WHEN tst.resolved_at IS NOT NULL AND tst.final_status != 'breached' THEN 1.0 ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN tst.resolved_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS DECIMAL(5,2)) AS sla_compliance_rate
        FROM TICKET_SLA_TRACKING tst
        ${whereClause}
      `;

      const result = await pool.request().query(query);
      return result.recordset[0];
    } catch (error) {
      console.error('Error getting SLA metrics:', error);
      throw error;
    }
  }

  /**
   * Update all active SLA tracking records (for background job)
   */
  static async updateAllActiveTracking() {
    try {
      const pool = await connectDB();

      // Get all active tracking records
      const result = await pool.request()
        .query(`
          SELECT ticket_id FROM TICKET_SLA_TRACKING
          WHERE resolved_at IS NULL AND is_paused = 0
        `);

      const updates = [];
      for (const record of result.recordset) {
        try {
          const updated = await this.updateElapsedTime(record.ticket_id);
          updates.push({ ticket_id: record.ticket_id, status: 'updated', sla_status: updated.sla_status });
        } catch (err) {
          updates.push({ ticket_id: record.ticket_id, status: 'error', error: err.message });
        }
      }

      return updates;
    } catch (error) {
      console.error('Error updating all active tracking:', error);
      throw error;
    }
  }
}

module.exports = SlaTrackingModel;
