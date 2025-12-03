/**
 * SLA RULES MODEL
 * Handles all database operations for SLA rule configuration
 */

const { connectDB, sql } = require('../config/database');

class SlaRulesModel {
  /**
   * Get all SLA rules with related data
   */
  static async getAllRules(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      if (filters.isActive !== undefined) {
        whereClause += ` AND sr.is_active = ${filters.isActive ? 1 : 0}`;
      }

      const query = `
        SELECT
          sr.rule_id AS sla_rule_id,
          sr.rule_name,
          sr.description,
          sr.priority_order,
          sr.applicable_asset_categories,
          sr.applicable_asset_importance,
          sr.applicable_user_category,
          sr.applicable_ticket_type,
          sr.applicable_ticket_channels,
          sr.applicable_priority,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.is_vip_override,
          sr.business_hours_schedule_id,
          sr.holiday_calendar_id,
          sr.allow_pause_resume,
          sr.pause_conditions,
          sr.is_active,
          sr.created_by,
          sr.created_at,
          sr.updated_at,
          bhs.schedule_name AS business_hours_name,
          bhs.is_24x7,
          hc.calendar_name AS holiday_calendar_name,
          u.first_name + ' ' + u.last_name AS created_by_name,
          (SELECT COUNT(*) FROM ESCALATION_RULES er WHERE er.sla_rule_id = sr.rule_id AND er.is_active = 1) AS escalation_levels_count
        FROM SLA_RULES sr
        LEFT JOIN BUSINESS_HOURS_SCHEDULES bhs ON sr.business_hours_schedule_id = bhs.schedule_id
        LEFT JOIN HOLIDAY_CALENDARS hc ON sr.holiday_calendar_id = hc.calendar_id
        LEFT JOIN USER_MASTER u ON sr.created_by = u.user_id
        ${whereClause}
        ORDER BY sr.priority_order ASC
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching SLA rules:', error);
      throw error;
    }
  }

  /**
   * Get SLA rule by ID with escalation rules
   */
  static async getRuleById(ruleId) {
    try {
      const pool = await connectDB();

      // Get rule
      const ruleQuery = `
        SELECT
          sr.rule_id AS sla_rule_id,
          sr.rule_name,
          sr.description,
          sr.priority_order,
          sr.applicable_asset_categories,
          sr.applicable_asset_importance,
          sr.applicable_user_category,
          sr.applicable_ticket_type,
          sr.applicable_ticket_channels,
          sr.applicable_priority,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.is_vip_override,
          sr.business_hours_schedule_id,
          sr.holiday_calendar_id,
          sr.allow_pause_resume,
          sr.pause_conditions,
          sr.is_active,
          sr.created_by,
          sr.created_at,
          sr.updated_at,
          bhs.schedule_name AS business_hours_name,
          bhs.is_24x7,
          hc.calendar_name AS holiday_calendar_name,
          u.first_name + ' ' + u.last_name AS created_by_name
        FROM SLA_RULES sr
        LEFT JOIN BUSINESS_HOURS_SCHEDULES bhs ON sr.business_hours_schedule_id = bhs.schedule_id
        LEFT JOIN HOLIDAY_CALENDARS hc ON sr.holiday_calendar_id = hc.calendar_id
        LEFT JOIN USER_MASTER u ON sr.created_by = u.user_id
        WHERE sr.rule_id = @ruleId
      `;

      const ruleResult = await pool.request()
        .input('ruleId', sql.UniqueIdentifier, ruleId)
        .query(ruleQuery);

      if (ruleResult.recordset.length === 0) {
        return null;
      }

      const rule = ruleResult.recordset[0];

      // Get escalation rules
      const escalationQuery = `
        SELECT *
        FROM ESCALATION_RULES
        WHERE sla_rule_id = @ruleId
        ORDER BY escalation_level ASC
      `;

      const escalationResult = await pool.request()
        .input('ruleId', sql.UniqueIdentifier, ruleId)
        .query(escalationQuery);

      rule.escalation_rules = escalationResult.recordset;

      return rule;
    } catch (error) {
      console.error('Error fetching SLA rule by ID:', error);
      throw error;
    }
  }

  /**
   * Create a new SLA rule
   */
  static async createRule(ruleData) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO SLA_RULES (
          rule_id, rule_name, description, priority_order,
          applicable_asset_categories, applicable_asset_importance,
          applicable_user_category, applicable_ticket_type,
          applicable_ticket_channels, applicable_priority,
          min_tat_minutes, avg_tat_minutes, max_tat_minutes,
          is_vip_override, business_hours_schedule_id, holiday_calendar_id,
          allow_pause_resume, pause_conditions, is_active, created_by, created_at
        )
        OUTPUT
          INSERTED.rule_id AS sla_rule_id,
          INSERTED.rule_name,
          INSERTED.description,
          INSERTED.priority_order,
          INSERTED.applicable_asset_categories,
          INSERTED.applicable_asset_importance,
          INSERTED.applicable_user_category,
          INSERTED.applicable_ticket_type,
          INSERTED.applicable_ticket_channels,
          INSERTED.applicable_priority,
          INSERTED.min_tat_minutes,
          INSERTED.avg_tat_minutes,
          INSERTED.max_tat_minutes,
          INSERTED.is_vip_override,
          INSERTED.business_hours_schedule_id,
          INSERTED.holiday_calendar_id,
          INSERTED.allow_pause_resume,
          INSERTED.pause_conditions,
          INSERTED.is_active,
          INSERTED.created_by,
          INSERTED.created_at
        VALUES (
          NEWID(), @ruleName, @description, @priorityOrder,
          @applicableAssetCategories, @applicableAssetImportance,
          @applicableUserCategory, @applicableTicketType,
          @applicableTicketChannels, @applicablePriority,
          @minTatMinutes, @avgTatMinutes, @maxTatMinutes,
          @isVipOverride, @businessHoursScheduleId, @holidayCalendarId,
          @allowPauseResume, @pauseConditions, @isActive, @createdBy, GETDATE()
        )
      `;

      const result = await pool.request()
        .input('ruleName', sql.NVarChar(255), ruleData.rule_name)
        .input('description', sql.NVarChar(500), ruleData.description)
        .input('priorityOrder', sql.Int, ruleData.priority_order)
        .input('applicableAssetCategories', sql.NVarChar(500), ruleData.applicable_asset_categories)
        .input('applicableAssetImportance', sql.NVarChar(100), ruleData.applicable_asset_importance)
        .input('applicableUserCategory', sql.NVarChar(100), ruleData.applicable_user_category)
        .input('applicableTicketType', sql.NVarChar(100), ruleData.applicable_ticket_type)
        .input('applicableTicketChannels', sql.NVarChar(200), ruleData.applicable_ticket_channels)
        .input('applicablePriority', sql.NVarChar(100), ruleData.applicable_priority)
        .input('minTatMinutes', sql.Int, ruleData.min_tat_minutes)
        .input('avgTatMinutes', sql.Int, ruleData.avg_tat_minutes)
        .input('maxTatMinutes', sql.Int, ruleData.max_tat_minutes)
        .input('isVipOverride', sql.Bit, ruleData.is_vip_override || false)
        .input('businessHoursScheduleId', sql.UniqueIdentifier, ruleData.business_hours_schedule_id)
        .input('holidayCalendarId', sql.UniqueIdentifier, ruleData.holiday_calendar_id)
        .input('allowPauseResume', sql.Bit, ruleData.allow_pause_resume !== false)
        .input('pauseConditions', sql.NVarChar(500), JSON.stringify(ruleData.pause_conditions || {}))
        .input('isActive', sql.Bit, ruleData.is_active !== false)
        .input('createdBy', sql.UniqueIdentifier, ruleData.created_by)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating SLA rule:', error);
      throw error;
    }
  }

  /**
   * Update an SLA rule
   */
  static async updateRule(ruleId, ruleData) {
    try {
      const pool = await connectDB();

      const query = `
        UPDATE SLA_RULES SET
          rule_name = @ruleName,
          description = @description,
          priority_order = @priorityOrder,
          applicable_asset_categories = @applicableAssetCategories,
          applicable_asset_importance = @applicableAssetImportance,
          applicable_user_category = @applicableUserCategory,
          applicable_ticket_type = @applicableTicketType,
          applicable_ticket_channels = @applicableTicketChannels,
          applicable_priority = @applicablePriority,
          min_tat_minutes = @minTatMinutes,
          avg_tat_minutes = @avgTatMinutes,
          max_tat_minutes = @maxTatMinutes,
          is_vip_override = @isVipOverride,
          business_hours_schedule_id = @businessHoursScheduleId,
          holiday_calendar_id = @holidayCalendarId,
          allow_pause_resume = @allowPauseResume,
          pause_conditions = @pauseConditions,
          is_active = @isActive,
          updated_at = GETDATE()
        OUTPUT
          INSERTED.rule_id AS sla_rule_id,
          INSERTED.rule_name,
          INSERTED.description,
          INSERTED.priority_order,
          INSERTED.applicable_asset_categories,
          INSERTED.applicable_asset_importance,
          INSERTED.applicable_user_category,
          INSERTED.applicable_ticket_type,
          INSERTED.applicable_ticket_channels,
          INSERTED.applicable_priority,
          INSERTED.min_tat_minutes,
          INSERTED.avg_tat_minutes,
          INSERTED.max_tat_minutes,
          INSERTED.is_vip_override,
          INSERTED.business_hours_schedule_id,
          INSERTED.holiday_calendar_id,
          INSERTED.allow_pause_resume,
          INSERTED.pause_conditions,
          INSERTED.is_active,
          INSERTED.created_by,
          INSERTED.created_at,
          INSERTED.updated_at
        WHERE rule_id = @ruleId
      `;

      const result = await pool.request()
        .input('ruleId', sql.UniqueIdentifier, ruleId)
        .input('ruleName', sql.NVarChar(255), ruleData.rule_name)
        .input('description', sql.NVarChar(500), ruleData.description)
        .input('priorityOrder', sql.Int, ruleData.priority_order)
        .input('applicableAssetCategories', sql.NVarChar(500), ruleData.applicable_asset_categories)
        .input('applicableAssetImportance', sql.NVarChar(100), ruleData.applicable_asset_importance)
        .input('applicableUserCategory', sql.NVarChar(100), ruleData.applicable_user_category)
        .input('applicableTicketType', sql.NVarChar(100), ruleData.applicable_ticket_type)
        .input('applicableTicketChannels', sql.NVarChar(200), ruleData.applicable_ticket_channels)
        .input('applicablePriority', sql.NVarChar(100), ruleData.applicable_priority)
        .input('minTatMinutes', sql.Int, ruleData.min_tat_minutes)
        .input('avgTatMinutes', sql.Int, ruleData.avg_tat_minutes)
        .input('maxTatMinutes', sql.Int, ruleData.max_tat_minutes)
        .input('isVipOverride', sql.Bit, ruleData.is_vip_override || false)
        .input('businessHoursScheduleId', sql.UniqueIdentifier, ruleData.business_hours_schedule_id)
        .input('holidayCalendarId', sql.UniqueIdentifier, ruleData.holiday_calendar_id)
        .input('allowPauseResume', sql.Bit, ruleData.allow_pause_resume !== false)
        .input('pauseConditions', sql.NVarChar(500), JSON.stringify(ruleData.pause_conditions || {}))
        .input('isActive', sql.Bit, ruleData.is_active !== false)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error updating SLA rule:', error);
      throw error;
    }
  }

  /**
   * Delete an SLA rule (soft delete by deactivating)
   */
  static async deleteRule(ruleId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ruleId', sql.UniqueIdentifier, ruleId)
        .query(`
          UPDATE SLA_RULES
          SET is_active = 0, updated_at = GETDATE()
          WHERE rule_id = @ruleId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting SLA rule:', error);
      throw error;
    }
  }

  /**
   * Get all business hours schedules
   */
  static async getBusinessHoursSchedules() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          bhs.*,
          (SELECT COUNT(*) FROM BUSINESS_HOURS_DETAILS bhd WHERE bhd.schedule_id = bhs.schedule_id) AS days_configured,
          (SELECT COUNT(*) FROM BREAK_HOURS bh WHERE bh.schedule_id = bhs.schedule_id AND bh.is_active = 1) AS breaks_count
        FROM BUSINESS_HOURS_SCHEDULES bhs
        WHERE bhs.is_active = 1
        ORDER BY bhs.schedule_name
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching business hours schedules:', error);
      throw error;
    }
  }

  /**
   * Get business hours details for a schedule
   */
  static async getBusinessHoursDetails(scheduleId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT *
        FROM BUSINESS_HOURS_DETAILS
        WHERE schedule_id = @scheduleId
        ORDER BY day_of_week
      `;

      const result = await pool.request()
        .input('scheduleId', sql.UniqueIdentifier, scheduleId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching business hours details:', error);
      throw error;
    }
  }

  /**
   * Get break hours for a schedule
   */
  static async getBreakHours(scheduleId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT *
        FROM BREAK_HOURS
        WHERE schedule_id = @scheduleId AND is_active = 1
        ORDER BY start_time
      `;

      const result = await pool.request()
        .input('scheduleId', sql.UniqueIdentifier, scheduleId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching break hours:', error);
      throw error;
    }
  }

  /**
   * Get all holiday calendars
   */
  static async getHolidayCalendars() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          hc.*,
          (SELECT COUNT(*) FROM HOLIDAY_DATES hd WHERE hd.calendar_id = hc.calendar_id) AS holidays_count
        FROM HOLIDAY_CALENDARS hc
        WHERE hc.is_active = 1
        ORDER BY hc.calendar_year DESC, hc.calendar_name
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching holiday calendars:', error);
      throw error;
    }
  }

  /**
   * Get holiday dates for a calendar
   */
  static async getHolidayDates(calendarId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT *
        FROM HOLIDAY_DATES
        WHERE calendar_id = @calendarId
        ORDER BY holiday_date
      `;

      const result = await pool.request()
        .input('calendarId', sql.UniqueIdentifier, calendarId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching holiday dates:', error);
      throw error;
    }
  }

  /**
   * Create/Update business hours schedule with details
   */
  static async saveBusinessHoursSchedule(scheduleData, createdBy) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        let scheduleId = scheduleData.schedule_id;

        if (scheduleId) {
          // Update existing schedule
          await transaction.request()
            .input('scheduleId', sql.UniqueIdentifier, scheduleId)
            .input('scheduleName', sql.NVarChar(255), scheduleData.schedule_name)
            .input('description', sql.NVarChar(500), scheduleData.description)
            .input('is24x7', sql.Bit, scheduleData.is_24x7 || false)
            .input('isDefault', sql.Bit, scheduleData.is_default || false)
            .input('timezone', sql.NVarChar(50), scheduleData.timezone || 'Asia/Kolkata')
            .query(`
              UPDATE BUSINESS_HOURS_SCHEDULES SET
                schedule_name = @scheduleName,
                description = @description,
                is_24x7 = @is24x7,
                is_default = @isDefault,
                timezone = @timezone,
                updated_at = GETDATE()
              WHERE schedule_id = @scheduleId
            `);
        } else {
          // Create new schedule
          const insertResult = await transaction.request()
            .input('scheduleName', sql.NVarChar(255), scheduleData.schedule_name)
            .input('description', sql.NVarChar(500), scheduleData.description)
            .input('is24x7', sql.Bit, scheduleData.is_24x7 || false)
            .input('isDefault', sql.Bit, scheduleData.is_default || false)
            .input('timezone', sql.NVarChar(50), scheduleData.timezone || 'Asia/Kolkata')
            .input('createdBy', sql.UniqueIdentifier, createdBy)
            .query(`
              INSERT INTO BUSINESS_HOURS_SCHEDULES (
                schedule_id, schedule_name, description, is_24x7, is_default, timezone, is_active, created_by, created_at
              )
              OUTPUT INSERTED.schedule_id
              VALUES (NEWID(), @scheduleName, @description, @is24x7, @isDefault, @timezone, 1, @createdBy, GETDATE())
            `);
          scheduleId = insertResult.recordset[0].schedule_id;
        }

        // Update business hours details
        if (scheduleData.details && scheduleData.details.length > 0) {
          // Delete existing details
          await transaction.request()
            .input('scheduleId', sql.UniqueIdentifier, scheduleId)
            .query('DELETE FROM BUSINESS_HOURS_DETAILS WHERE schedule_id = @scheduleId');

          // Insert new details
          for (const detail of scheduleData.details) {
            await transaction.request()
              .input('scheduleId', sql.UniqueIdentifier, scheduleId)
              .input('dayOfWeek', sql.Int, detail.day_of_week)
              .input('isWorkingDay', sql.Bit, detail.is_working_day)
              .input('startTime', sql.Time, detail.start_time)
              .input('endTime', sql.Time, detail.end_time)
              .query(`
                INSERT INTO BUSINESS_HOURS_DETAILS (
                  detail_id, schedule_id, day_of_week, is_working_day, start_time, end_time, created_at
                )
                VALUES (NEWID(), @scheduleId, @dayOfWeek, @isWorkingDay, @startTime, @endTime, GETDATE())
              `);
          }
        }

        await transaction.commit();
        return scheduleId;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error saving business hours schedule:', error);
      throw error;
    }
  }

  /**
   * Delete business hours schedule (soft delete)
   */
  static async deleteBusinessHoursSchedule(scheduleId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('scheduleId', sql.UniqueIdentifier, scheduleId)
        .query(`
          UPDATE BUSINESS_HOURS_SCHEDULES
          SET is_active = 0, updated_at = GETDATE()
          WHERE schedule_id = @scheduleId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting business hours schedule:', error);
      throw error;
    }
  }

  /**
   * Create/Update holiday calendar with dates
   */
  static async saveHolidayCalendar(calendarData, createdBy) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        let calendarId = calendarData.calendar_id;

        if (calendarId) {
          // Update existing calendar
          await transaction.request()
            .input('calendarId', sql.UniqueIdentifier, calendarId)
            .input('calendarName', sql.NVarChar(255), calendarData.calendar_name)
            .input('description', sql.NVarChar(500), calendarData.description)
            .input('calendarYear', sql.Int, calendarData.calendar_year)
            .query(`
              UPDATE HOLIDAY_CALENDARS SET
                calendar_name = @calendarName,
                description = @description,
                calendar_year = @calendarYear,
                updated_at = GETDATE()
              WHERE calendar_id = @calendarId
            `);
        } else {
          // Create new calendar
          const insertResult = await transaction.request()
            .input('calendarName', sql.NVarChar(255), calendarData.calendar_name)
            .input('description', sql.NVarChar(500), calendarData.description)
            .input('calendarYear', sql.Int, calendarData.calendar_year)
            .input('createdBy', sql.UniqueIdentifier, createdBy)
            .query(`
              INSERT INTO HOLIDAY_CALENDARS (
                calendar_id, calendar_name, description, calendar_year, is_active, created_by, created_at
              )
              OUTPUT INSERTED.calendar_id
              VALUES (NEWID(), @calendarName, @description, @calendarYear, 1, @createdBy, GETDATE())
            `);
          calendarId = insertResult.recordset[0].calendar_id;
        }

        // Update holiday dates
        if (calendarData.dates && calendarData.dates.length > 0) {
          // Delete existing dates
          await transaction.request()
            .input('calendarId', sql.UniqueIdentifier, calendarId)
            .query('DELETE FROM HOLIDAY_DATES WHERE calendar_id = @calendarId');

          // Insert new dates
          for (const date of calendarData.dates) {
            await transaction.request()
              .input('calendarId', sql.UniqueIdentifier, calendarId)
              .input('holidayDate', sql.Date, date.holiday_date)
              .input('holidayName', sql.NVarChar(255), date.holiday_name)
              .input('isFullDay', sql.Bit, date.is_full_day !== false)
              .input('isRecurring', sql.Bit, date.is_recurring || false)
              .input('startTime', sql.Time, date.start_time)
              .input('endTime', sql.Time, date.end_time)
              .query(`
                INSERT INTO HOLIDAY_DATES (
                  holiday_id, calendar_id, holiday_date, holiday_name, is_full_day, is_recurring, start_time, end_time, created_at
                )
                VALUES (NEWID(), @calendarId, @holidayDate, @holidayName, @isFullDay, @isRecurring, @startTime, @endTime, GETDATE())
              `);
          }
        }

        await transaction.commit();
        return calendarId;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error saving holiday calendar:', error);
      throw error;
    }
  }

  /**
   * Delete holiday calendar (soft delete)
   */
  static async deleteHolidayCalendar(calendarId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('calendarId', sql.UniqueIdentifier, calendarId)
        .query(`
          UPDATE HOLIDAY_CALENDARS
          SET is_active = 0, updated_at = GETDATE()
          WHERE calendar_id = @calendarId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting holiday calendar:', error);
      throw error;
    }
  }

  /**
   * Get escalation rules for an SLA rule
   */
  static async getEscalationRulesForSla(slaRuleId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('slaRuleId', sql.UniqueIdentifier, slaRuleId)
        .query(`
          SELECT * FROM ESCALATION_RULES
          WHERE sla_rule_id = @slaRuleId
          ORDER BY escalation_level ASC
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error getting escalation rules:', error);
      throw error;
    }
  }

  /**
   * Create/Update escalation rule
   */
  static async saveEscalationRule(escalationData) {
    try {
      const pool = await connectDB();

      if (escalationData.escalation_rule_id) {
        // Update existing
        const query = `
          UPDATE ESCALATION_RULES SET
            escalation_level = @escalationLevel,
            trigger_type = @triggerType,
            reference_threshold = @referenceThreshold,
            trigger_offset_minutes = @triggerOffsetMinutes,
            repeat_interval_minutes = @repeatIntervalMinutes,
            max_repeat_count = @maxRepeatCount,
            recipient_type = @recipientType,
            recipient_group_id = @recipientGroupId,
            recipient_role = @recipientRole,
            number_of_recipients = @numberOfRecipients,
            escalation_type = @escalationType,
            notification_template = @notificationTemplate,
            include_ticket_details = @includeTicketDetails,
            is_active = @isActive,
            updated_at = GETDATE()
          OUTPUT INSERTED.*
          WHERE escalation_rule_id = @escalationRuleId
        `;

        const result = await pool.request()
          .input('escalationRuleId', sql.UniqueIdentifier, escalationData.escalation_rule_id)
          .input('escalationLevel', sql.Int, escalationData.escalation_level)
          .input('triggerType', sql.NVarChar(30), escalationData.trigger_type)
          .input('referenceThreshold', sql.NVarChar(20), escalationData.reference_threshold)
          .input('triggerOffsetMinutes', sql.Int, escalationData.trigger_offset_minutes || 0)
          .input('repeatIntervalMinutes', sql.Int, escalationData.repeat_interval_minutes)
          .input('maxRepeatCount', sql.Int, escalationData.max_repeat_count)
          .input('recipientType', sql.NVarChar(30), escalationData.recipient_type)
          .input('recipientGroupId', sql.UniqueIdentifier, escalationData.recipient_group_id)
          .input('recipientRole', sql.NVarChar(50), escalationData.recipient_role)
          .input('numberOfRecipients', sql.Int, escalationData.number_of_recipients || 1)
          .input('escalationType', sql.NVarChar(20), escalationData.escalation_type)
          .input('notificationTemplate', sql.NVarChar(100), escalationData.notification_template)
          .input('includeTicketDetails', sql.Bit, escalationData.include_ticket_details !== false)
          .input('isActive', sql.Bit, escalationData.is_active !== false)
          .query(query);

        return result.recordset[0];
      } else {
        // Create new
        const query = `
          INSERT INTO ESCALATION_RULES (
            escalation_rule_id, sla_rule_id, escalation_level, trigger_type,
            reference_threshold, trigger_offset_minutes, repeat_interval_minutes, max_repeat_count,
            recipient_type, recipient_group_id, recipient_role, number_of_recipients,
            escalation_type, notification_template, include_ticket_details, is_active, created_at
          )
          OUTPUT INSERTED.*
          VALUES (
            NEWID(), @slaRuleId, @escalationLevel, @triggerType,
            @referenceThreshold, @triggerOffsetMinutes, @repeatIntervalMinutes, @maxRepeatCount,
            @recipientType, @recipientGroupId, @recipientRole, @numberOfRecipients,
            @escalationType, @notificationTemplate, @includeTicketDetails, @isActive, GETDATE()
          )
        `;

        const result = await pool.request()
          .input('slaRuleId', sql.UniqueIdentifier, escalationData.sla_rule_id)
          .input('escalationLevel', sql.Int, escalationData.escalation_level)
          .input('triggerType', sql.NVarChar(30), escalationData.trigger_type)
          .input('referenceThreshold', sql.NVarChar(20), escalationData.reference_threshold)
          .input('triggerOffsetMinutes', sql.Int, escalationData.trigger_offset_minutes || 0)
          .input('repeatIntervalMinutes', sql.Int, escalationData.repeat_interval_minutes)
          .input('maxRepeatCount', sql.Int, escalationData.max_repeat_count)
          .input('recipientType', sql.NVarChar(30), escalationData.recipient_type)
          .input('recipientGroupId', sql.UniqueIdentifier, escalationData.recipient_group_id)
          .input('recipientRole', sql.NVarChar(50), escalationData.recipient_role)
          .input('numberOfRecipients', sql.Int, escalationData.number_of_recipients || 1)
          .input('escalationType', sql.NVarChar(20), escalationData.escalation_type)
          .input('notificationTemplate', sql.NVarChar(100), escalationData.notification_template)
          .input('includeTicketDetails', sql.Bit, escalationData.include_ticket_details !== false)
          .input('isActive', sql.Bit, escalationData.is_active !== false)
          .query(query);

        return result.recordset[0];
      }
    } catch (error) {
      console.error('Error saving escalation rule:', error);
      throw error;
    }
  }

  /**
   * Delete escalation rule
   */
  static async deleteEscalationRule(escalationRuleId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('escalationRuleId', sql.UniqueIdentifier, escalationRuleId)
        .query('DELETE FROM ESCALATION_RULES WHERE escalation_rule_id = @escalationRuleId');

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting escalation rule:', error);
      throw error;
    }
  }
}

module.exports = SlaRulesModel;
