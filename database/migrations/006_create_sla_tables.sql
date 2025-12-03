-- =============================================
-- SLA (Service Level Agreement) System Tables
-- Migration: 006_create_sla_tables.sql
-- Description: Creates all tables required for SLA management,
--              business hours, holidays, tracking, and escalations
-- =============================================

USE asset_management;
GO

-- =============================================
-- 1. BUSINESS_HOURS_SCHEDULES
-- Defines working hours schedules (e.g., 9-5 Mon-Fri, 24/7)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'BUSINESS_HOURS_SCHEDULES') AND type = 'U')
BEGIN
    CREATE TABLE BUSINESS_HOURS_SCHEDULES (
        schedule_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        schedule_name NVARCHAR(255) NOT NULL,
        description NVARCHAR(500) NULL,
        is_24x7 BIT NOT NULL DEFAULT 0,
        timezone NVARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
        is_active BIT NOT NULL DEFAULT 1,
        created_by UNIQUEIDENTIFIER NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_BHS_CreatedBy FOREIGN KEY (created_by) REFERENCES USER_MASTER(user_id)
    );

    PRINT 'Created table: BUSINESS_HOURS_SCHEDULES';
END
GO

-- =============================================
-- 2. BUSINESS_HOURS_DETAILS
-- Day-wise working hours configuration per schedule
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'BUSINESS_HOURS_DETAILS') AND type = 'U')
BEGIN
    CREATE TABLE BUSINESS_HOURS_DETAILS (
        detail_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        schedule_id UNIQUEIDENTIFIER NOT NULL,
        day_of_week INT NOT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
        is_working_day BIT NOT NULL DEFAULT 1,
        start_time TIME NULL, -- NULL if not a working day
        end_time TIME NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_BHD_Schedule FOREIGN KEY (schedule_id) REFERENCES BUSINESS_HOURS_SCHEDULES(schedule_id) ON DELETE CASCADE,
        CONSTRAINT CK_BHD_DayOfWeek CHECK (day_of_week >= 0 AND day_of_week <= 6),
        CONSTRAINT UQ_BHD_ScheduleDay UNIQUE (schedule_id, day_of_week)
    );

    PRINT 'Created table: BUSINESS_HOURS_DETAILS';
END
GO

-- =============================================
-- 3. BREAK_HOURS
-- Break periods within working hours (e.g., lunch break)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'BREAK_HOURS') AND type = 'U')
BEGIN
    CREATE TABLE BREAK_HOURS (
        break_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        schedule_id UNIQUEIDENTIFIER NOT NULL,
        break_name NVARCHAR(100) NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        applies_to_days NVARCHAR(50) NOT NULL DEFAULT '[1,2,3,4,5]', -- JSON array of day numbers or 'all'
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_BH_Schedule FOREIGN KEY (schedule_id) REFERENCES BUSINESS_HOURS_SCHEDULES(schedule_id) ON DELETE CASCADE
    );

    PRINT 'Created table: BREAK_HOURS';
END
GO

-- =============================================
-- 4. HOLIDAY_CALENDARS
-- Holiday calendar definitions by year
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'HOLIDAY_CALENDARS') AND type = 'U')
BEGIN
    CREATE TABLE HOLIDAY_CALENDARS (
        calendar_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        calendar_name NVARCHAR(255) NOT NULL,
        description NVARCHAR(500) NULL,
        calendar_year INT NOT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_by UNIQUEIDENTIFIER NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_HC_CreatedBy FOREIGN KEY (created_by) REFERENCES USER_MASTER(user_id),
        CONSTRAINT UQ_HC_NameYear UNIQUE (calendar_name, calendar_year)
    );

    PRINT 'Created table: HOLIDAY_CALENDARS';
END
GO

-- =============================================
-- 5. HOLIDAY_DATES
-- Individual holiday dates within a calendar
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'HOLIDAY_DATES') AND type = 'U')
BEGIN
    CREATE TABLE HOLIDAY_DATES (
        holiday_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        calendar_id UNIQUEIDENTIFIER NOT NULL,
        holiday_date DATE NOT NULL,
        holiday_name NVARCHAR(255) NOT NULL,
        is_full_day BIT NOT NULL DEFAULT 1,
        start_time TIME NULL, -- If partial day holiday
        end_time TIME NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_HD_Calendar FOREIGN KEY (calendar_id) REFERENCES HOLIDAY_CALENDARS(calendar_id) ON DELETE CASCADE,
        CONSTRAINT UQ_HD_CalendarDate UNIQUE (calendar_id, holiday_date)
    );

    PRINT 'Created table: HOLIDAY_DATES';
END
GO

-- =============================================
-- 6. SLA_RULES
-- Main SLA rule configuration table
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'SLA_RULES') AND type = 'U')
BEGIN
    CREATE TABLE SLA_RULES (
        rule_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        rule_name NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        priority_order INT NOT NULL DEFAULT 100, -- Lower number = higher priority

        -- Matching conditions (stored as JSON arrays or single values)
        applicable_asset_categories NVARCHAR(MAX) NULL, -- JSON array of category IDs, NULL/empty = all
        applicable_asset_importance NVARCHAR(50) NULL DEFAULT 'all', -- critical/high/medium/low/all
        applicable_user_category NVARCHAR(50) NULL DEFAULT 'all', -- vip/normal/all
        applicable_ticket_type NVARCHAR(50) NULL DEFAULT 'all', -- incident/service_request/problem/all
        applicable_ticket_channels NVARCHAR(MAX) NULL, -- JSON array: email/phone/chat/portal, NULL = all
        applicable_priority NVARCHAR(50) NULL DEFAULT 'all', -- critical/high/medium/low/all (ticket priority)

        -- TAT thresholds (in minutes)
        min_tat_minutes INT NOT NULL DEFAULT 30, -- Minimum (benchmark for excellence)
        avg_tat_minutes INT NOT NULL DEFAULT 240, -- Target (primary goal)
        max_tat_minutes INT NOT NULL DEFAULT 480, -- Maximum (breach threshold)

        -- VIP override flag
        is_vip_override BIT NOT NULL DEFAULT 0, -- If true, takes absolute priority for VIP users

        -- Business hours configuration
        business_hours_schedule_id UNIQUEIDENTIFIER NULL, -- NULL = 24/7
        holiday_calendar_id UNIQUEIDENTIFIER NULL,

        -- Pause/Resume configuration
        allow_pause_resume BIT NOT NULL DEFAULT 1,
        pause_conditions NVARCHAR(MAX) NULL, -- JSON array of statuses that pause SLA

        -- Status
        is_active BIT NOT NULL DEFAULT 1,

        -- Audit
        created_by UNIQUEIDENTIFIER NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_SLA_BusinessHours FOREIGN KEY (business_hours_schedule_id) REFERENCES BUSINESS_HOURS_SCHEDULES(schedule_id),
        CONSTRAINT FK_SLA_HolidayCalendar FOREIGN KEY (holiday_calendar_id) REFERENCES HOLIDAY_CALENDARS(calendar_id),
        CONSTRAINT FK_SLA_CreatedBy FOREIGN KEY (created_by) REFERENCES USER_MASTER(user_id),
        CONSTRAINT UQ_SLA_RuleName UNIQUE (rule_name)
    );

    -- Index for priority ordering
    CREATE NONCLUSTERED INDEX IX_SLA_RULES_Priority ON SLA_RULES(priority_order, is_active);

    PRINT 'Created table: SLA_RULES';
END
GO

-- =============================================
-- 7. TICKET_SLA_TRACKING
-- Per-ticket SLA state tracking
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'TICKET_SLA_TRACKING') AND type = 'U')
BEGIN
    CREATE TABLE TICKET_SLA_TRACKING (
        tracking_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ticket_id UNIQUEIDENTIFIER NOT NULL,
        sla_rule_id UNIQUEIDENTIFIER NOT NULL,

        -- SLA timing
        sla_start_time DATETIME NOT NULL DEFAULT GETDATE(),
        min_target_time DATETIME NULL, -- Calculated: start + min_tat (business hours)
        avg_target_time DATETIME NULL, -- Calculated: start + avg_tat (business hours)
        max_target_time DATETIME NULL, -- Calculated: start + max_tat (breach time)

        -- Elapsed time tracking (in minutes)
        total_elapsed_minutes INT NOT NULL DEFAULT 0, -- Total chronological minutes
        business_elapsed_minutes INT NOT NULL DEFAULT 0, -- Business minutes only
        total_paused_minutes INT NOT NULL DEFAULT 0, -- Total time spent paused

        -- Pause state
        is_paused BIT NOT NULL DEFAULT 0,
        pause_started_at DATETIME NULL,
        current_pause_reason NVARCHAR(100) NULL,

        -- Current status
        sla_status NVARCHAR(50) NOT NULL DEFAULT 'on_track', -- on_track/warning/at_risk/breached/paused
        warning_triggered_at DATETIME NULL,
        breach_triggered_at DATETIME NULL,

        -- Resolution
        resolved_at DATETIME NULL,
        final_status NVARCHAR(50) NULL, -- met_early/met/met_late/breached (final outcome)

        -- Last calculation timestamp
        last_calculated_at DATETIME NOT NULL DEFAULT GETDATE(),

        -- Audit
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_TST_Ticket FOREIGN KEY (ticket_id) REFERENCES TICKETS(ticket_id) ON DELETE CASCADE,
        CONSTRAINT FK_TST_SLARule FOREIGN KEY (sla_rule_id) REFERENCES SLA_RULES(rule_id),
        CONSTRAINT UQ_TST_Ticket UNIQUE (ticket_id) -- One SLA tracking per ticket
    );

    -- Indexes for monitoring queries
    CREATE NONCLUSTERED INDEX IX_TST_Status ON TICKET_SLA_TRACKING(sla_status, is_paused) WHERE final_status IS NULL;
    CREATE NONCLUSTERED INDEX IX_TST_TargetTime ON TICKET_SLA_TRACKING(max_target_time) WHERE final_status IS NULL;

    PRINT 'Created table: TICKET_SLA_TRACKING';
END
GO

-- =============================================
-- 8. TICKET_SLA_PAUSE_LOG
-- Pause/resume audit trail
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'TICKET_SLA_PAUSE_LOG') AND type = 'U')
BEGIN
    CREATE TABLE TICKET_SLA_PAUSE_LOG (
        log_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        tracking_id UNIQUEIDENTIFIER NOT NULL,
        action NVARCHAR(20) NOT NULL, -- 'paused' or 'resumed'
        ticket_status NVARCHAR(50) NOT NULL, -- Status that triggered the action
        reason NVARCHAR(500) NULL, -- Additional notes
        action_at DATETIME NOT NULL DEFAULT GETDATE(),
        paused_duration_minutes INT NULL, -- Set on resume (duration of this pause)
        created_by UNIQUEIDENTIFIER NULL, -- System or user who triggered

        CONSTRAINT FK_TSPL_Tracking FOREIGN KEY (tracking_id) REFERENCES TICKET_SLA_TRACKING(tracking_id) ON DELETE CASCADE,
        CONSTRAINT FK_TSPL_CreatedBy FOREIGN KEY (created_by) REFERENCES USER_MASTER(user_id),
        CONSTRAINT CK_TSPL_Action CHECK (action IN ('paused', 'resumed'))
    );

    CREATE NONCLUSTERED INDEX IX_TSPL_Tracking ON TICKET_SLA_PAUSE_LOG(tracking_id, action_at DESC);

    PRINT 'Created table: TICKET_SLA_PAUSE_LOG';
END
GO

-- =============================================
-- 9. ESCALATION_RULES
-- Multi-level escalation configuration per SLA rule
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'ESCALATION_RULES') AND type = 'U')
BEGIN
    CREATE TABLE ESCALATION_RULES (
        escalation_rule_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        sla_rule_id UNIQUEIDENTIFIER NOT NULL,
        escalation_level INT NOT NULL, -- 1, 2, 3, 4...

        -- Trigger configuration
        trigger_type NVARCHAR(50) NOT NULL, -- warning_zone/imminent_breach/breached/recurring_breach
        reference_threshold NVARCHAR(20) NOT NULL DEFAULT 'max_tat', -- avg_tat/max_tat
        trigger_offset_minutes INT NOT NULL DEFAULT 0, -- Minutes relative to threshold (-30, 0, +60)

        -- Repeat configuration
        repeat_interval_minutes INT NULL, -- NULL = no repeat, else repeat every N minutes
        max_repeat_count INT NULL, -- NULL = unlimited

        -- Recipient configuration
        recipient_type NVARCHAR(50) NOT NULL, -- assigned_engineer/coordinator/team_leader/department_head/custom_group
        recipient_group_id UNIQUEIDENTIFIER NULL, -- FK to user group if custom_group
        recipient_role NVARCHAR(100) NULL, -- Role name to notify
        number_of_recipients INT NOT NULL DEFAULT 1, -- How many to notify (1, -1 for all)

        -- Escalation type
        escalation_type NVARCHAR(50) NOT NULL DEFAULT 'hierarchical', -- hierarchical/functional

        -- Notification
        notification_template NVARCHAR(100) NULL, -- Template name for notification
        include_ticket_details BIT NOT NULL DEFAULT 1,

        -- Status
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_ER_SLARule FOREIGN KEY (sla_rule_id) REFERENCES SLA_RULES(rule_id) ON DELETE CASCADE,
        CONSTRAINT CK_ER_TriggerType CHECK (trigger_type IN ('warning_zone', 'imminent_breach', 'breached', 'recurring_breach')),
        CONSTRAINT CK_ER_RefThreshold CHECK (reference_threshold IN ('avg_tat', 'max_tat')),
        CONSTRAINT CK_ER_RecipientType CHECK (recipient_type IN ('assigned_engineer', 'coordinator', 'team_leader', 'department_head', 'project_owner', 'custom_group')),
        CONSTRAINT CK_ER_EscalationType CHECK (escalation_type IN ('hierarchical', 'functional')),
        CONSTRAINT UQ_ER_RuleLevel UNIQUE (sla_rule_id, escalation_level)
    );

    CREATE NONCLUSTERED INDEX IX_ER_SLARule ON ESCALATION_RULES(sla_rule_id, escalation_level);

    PRINT 'Created table: ESCALATION_RULES';
END
GO

-- =============================================
-- 10. ESCALATION_NOTIFICATIONS_LOG
-- Sent notification history
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'ESCALATION_NOTIFICATIONS_LOG') AND type = 'U')
BEGIN
    CREATE TABLE ESCALATION_NOTIFICATIONS_LOG (
        notification_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        tracking_id UNIQUEIDENTIFIER NOT NULL,
        escalation_rule_id UNIQUEIDENTIFIER NOT NULL,
        escalation_level INT NOT NULL,
        trigger_type NVARCHAR(50) NOT NULL,

        -- Recipients
        recipients NVARCHAR(MAX) NOT NULL, -- JSON array of {user_id, name, email}

        -- Timing
        notification_sent_at DATETIME NOT NULL DEFAULT GETDATE(),
        repeat_count INT NOT NULL DEFAULT 0, -- 0 = first notification

        -- Acknowledgement
        acknowledged_at DATETIME NULL,
        acknowledged_by UNIQUEIDENTIFIER NULL,

        -- Status
        delivery_status NVARCHAR(50) NOT NULL DEFAULT 'sent', -- sent/delivered/failed
        error_message NVARCHAR(500) NULL,

        created_at DATETIME NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_ENL_Tracking FOREIGN KEY (tracking_id) REFERENCES TICKET_SLA_TRACKING(tracking_id) ON DELETE CASCADE,
        CONSTRAINT FK_ENL_EscalationRule FOREIGN KEY (escalation_rule_id) REFERENCES ESCALATION_RULES(escalation_rule_id),
        CONSTRAINT FK_ENL_AcknowledgedBy FOREIGN KEY (acknowledged_by) REFERENCES USER_MASTER(user_id)
    );

    CREATE NONCLUSTERED INDEX IX_ENL_Tracking ON ESCALATION_NOTIFICATIONS_LOG(tracking_id, notification_sent_at DESC);
    CREATE NONCLUSTERED INDEX IX_ENL_Rule ON ESCALATION_NOTIFICATIONS_LOG(escalation_rule_id, tracking_id);

    PRINT 'Created table: ESCALATION_NOTIFICATIONS_LOG';
END
GO

-- =============================================
-- 11. ALTER TICKETS TABLE - Add ticket_channel and ticket_type
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'TICKETS') AND name = 'ticket_channel')
BEGIN
    ALTER TABLE TICKETS ADD ticket_channel NVARCHAR(30) NULL DEFAULT 'portal';
    PRINT 'Added column: ticket_channel to TICKETS';
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'TICKETS') AND name = 'ticket_type')
BEGIN
    ALTER TABLE TICKETS ADD ticket_type NVARCHAR(30) NULL DEFAULT 'incident';
    PRINT 'Added column: ticket_type to TICKETS';
END
GO

-- =============================================
-- SEED DATA: Default Business Hours Schedule (9-5 Mon-Fri)
-- =============================================
IF NOT EXISTS (SELECT 1 FROM BUSINESS_HOURS_SCHEDULES WHERE schedule_name = 'Standard Business Hours (9-5 Mon-Fri)')
BEGIN
    DECLARE @DefaultScheduleId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO BUSINESS_HOURS_SCHEDULES (schedule_id, schedule_name, description, is_24x7, timezone, is_active)
    VALUES (@DefaultScheduleId, 'Standard Business Hours (9-5 Mon-Fri)', 'Standard 9 AM to 5 PM, Monday through Friday', 0, 'Asia/Kolkata', 1);

    -- Insert day-wise configuration
    INSERT INTO BUSINESS_HOURS_DETAILS (schedule_id, day_of_week, is_working_day, start_time, end_time)
    VALUES
        (@DefaultScheduleId, 0, 0, NULL, NULL),           -- Sunday - Off
        (@DefaultScheduleId, 1, 1, '09:00:00', '17:00:00'), -- Monday
        (@DefaultScheduleId, 2, 1, '09:00:00', '17:00:00'), -- Tuesday
        (@DefaultScheduleId, 3, 1, '09:00:00', '17:00:00'), -- Wednesday
        (@DefaultScheduleId, 4, 1, '09:00:00', '17:00:00'), -- Thursday
        (@DefaultScheduleId, 5, 1, '09:00:00', '17:00:00'), -- Friday
        (@DefaultScheduleId, 6, 0, NULL, NULL);           -- Saturday - Off

    -- Add lunch break
    INSERT INTO BREAK_HOURS (schedule_id, break_name, start_time, end_time, applies_to_days, is_active)
    VALUES (@DefaultScheduleId, 'Lunch Break', '13:00:00', '14:00:00', '[1,2,3,4,5]', 1);

    PRINT 'Inserted seed data: Standard Business Hours Schedule';
END
GO

-- =============================================
-- SEED DATA: 24/7 Schedule
-- =============================================
IF NOT EXISTS (SELECT 1 FROM BUSINESS_HOURS_SCHEDULES WHERE schedule_name = '24/7 Support')
BEGIN
    INSERT INTO BUSINESS_HOURS_SCHEDULES (schedule_name, description, is_24x7, timezone, is_active)
    VALUES ('24/7 Support', 'Round-the-clock support - 24 hours, 7 days a week', 1, 'Asia/Kolkata', 1);

    PRINT 'Inserted seed data: 24/7 Support Schedule';
END
GO

-- =============================================
-- SEED DATA: Default Holiday Calendar 2025
-- =============================================
IF NOT EXISTS (SELECT 1 FROM HOLIDAY_CALENDARS WHERE calendar_name = 'India Holidays' AND calendar_year = 2025)
BEGIN
    DECLARE @CalendarId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO HOLIDAY_CALENDARS (calendar_id, calendar_name, description, calendar_year, is_active)
    VALUES (@CalendarId, 'India Holidays', 'Indian national and regional holidays for 2025', 2025, 1);

    -- Insert common Indian holidays for 2025
    INSERT INTO HOLIDAY_DATES (calendar_id, holiday_date, holiday_name, is_full_day)
    VALUES
        (@CalendarId, '2025-01-26', 'Republic Day', 1),
        (@CalendarId, '2025-03-14', 'Holi', 1),
        (@CalendarId, '2025-04-14', 'Ambedkar Jayanti', 1),
        (@CalendarId, '2025-04-18', 'Good Friday', 1),
        (@CalendarId, '2025-05-01', 'May Day', 1),
        (@CalendarId, '2025-08-15', 'Independence Day', 1),
        (@CalendarId, '2025-10-02', 'Gandhi Jayanti', 1),
        (@CalendarId, '2025-10-20', 'Dussehra', 1),
        (@CalendarId, '2025-11-01', 'Diwali', 1),
        (@CalendarId, '2025-12-25', 'Christmas', 1);

    PRINT 'Inserted seed data: India Holidays 2025';
END
GO

-- =============================================
-- SEED DATA: Default SLA Rules
-- =============================================
-- Get schedule and calendar IDs for default SLA rules
DECLARE @StdScheduleId UNIQUEIDENTIFIER;
DECLARE @HolidayCalendarId UNIQUEIDENTIFIER;

SELECT @StdScheduleId = schedule_id FROM BUSINESS_HOURS_SCHEDULES WHERE schedule_name = 'Standard Business Hours (9-5 Mon-Fri)';
SELECT @HolidayCalendarId = calendar_id FROM HOLIDAY_CALENDARS WHERE calendar_name = 'India Holidays' AND calendar_year = 2025;

-- VIP Critical Override Rule (Priority 1)
IF NOT EXISTS (SELECT 1 FROM SLA_RULES WHERE rule_name = 'VIP Critical Override')
BEGIN
    INSERT INTO SLA_RULES (
        rule_name, description, priority_order,
        applicable_user_category, is_vip_override,
        min_tat_minutes, avg_tat_minutes, max_tat_minutes,
        business_hours_schedule_id, holiday_calendar_id,
        allow_pause_resume, pause_conditions, is_active
    )
    VALUES (
        'VIP Critical Override',
        'Highest priority SLA for VIP users - overrides all other rules',
        1,
        'vip', 1,
        15, 60, 120, -- 15 min / 1 hr / 2 hrs
        @StdScheduleId, @HolidayCalendarId,
        1, '["waiting_on_customer", "on_hold", "pending_approval"]', 1
    );
    PRINT 'Inserted SLA Rule: VIP Critical Override';
END

-- Critical Assets Rule (Priority 10)
IF NOT EXISTS (SELECT 1 FROM SLA_RULES WHERE rule_name = 'Critical Assets SLA')
BEGIN
    INSERT INTO SLA_RULES (
        rule_name, description, priority_order,
        applicable_asset_importance,
        min_tat_minutes, avg_tat_minutes, max_tat_minutes,
        business_hours_schedule_id, holiday_calendar_id,
        allow_pause_resume, pause_conditions, is_active
    )
    VALUES (
        'Critical Assets SLA',
        'SLA for assets marked as critical importance',
        10,
        'critical',
        30, 120, 240, -- 30 min / 2 hrs / 4 hrs
        @StdScheduleId, @HolidayCalendarId,
        1, '["waiting_on_customer", "on_hold", "pending_approval"]', 1
    );
    PRINT 'Inserted SLA Rule: Critical Assets SLA';
END

-- High Priority Tickets Rule (Priority 20)
IF NOT EXISTS (SELECT 1 FROM SLA_RULES WHERE rule_name = 'High Priority SLA')
BEGIN
    INSERT INTO SLA_RULES (
        rule_name, description, priority_order,
        applicable_priority,
        min_tat_minutes, avg_tat_minutes, max_tat_minutes,
        business_hours_schedule_id, holiday_calendar_id,
        allow_pause_resume, pause_conditions, is_active
    )
    VALUES (
        'High Priority SLA',
        'SLA for tickets marked as high priority',
        20,
        'high',
        60, 240, 480, -- 1 hr / 4 hrs / 8 hrs
        @StdScheduleId, @HolidayCalendarId,
        1, '["waiting_on_customer", "on_hold", "pending_approval"]', 1
    );
    PRINT 'Inserted SLA Rule: High Priority SLA';
END

-- Default SLA Rule (Priority 999 - Catch All)
IF NOT EXISTS (SELECT 1 FROM SLA_RULES WHERE rule_name = 'Default SLA')
BEGIN
    INSERT INTO SLA_RULES (
        rule_name, description, priority_order,
        applicable_asset_importance, applicable_user_category, applicable_ticket_type, applicable_priority,
        min_tat_minutes, avg_tat_minutes, max_tat_minutes,
        business_hours_schedule_id, holiday_calendar_id,
        allow_pause_resume, pause_conditions, is_active
    )
    VALUES (
        'Default SLA',
        'Default catch-all SLA rule when no other rule matches',
        999,
        'all', 'all', 'all', 'all',
        120, 480, 1440, -- 2 hrs / 8 hrs / 24 hrs
        @StdScheduleId, @HolidayCalendarId,
        1, '["waiting_on_customer", "on_hold", "pending_approval"]', 1
    );
    PRINT 'Inserted SLA Rule: Default SLA';
END
GO

-- =============================================
-- SEED DATA: Default Escalation Rules
-- =============================================
DECLARE @VIPRuleId UNIQUEIDENTIFIER;
DECLARE @DefaultRuleId UNIQUEIDENTIFIER;

SELECT @VIPRuleId = rule_id FROM SLA_RULES WHERE rule_name = 'VIP Critical Override';
SELECT @DefaultRuleId = rule_id FROM SLA_RULES WHERE rule_name = 'Default SLA';

-- VIP Rule Escalations
IF @VIPRuleId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ESCALATION_RULES WHERE sla_rule_id = @VIPRuleId)
BEGIN
    -- Level 1: Warning at 30 min before avg TAT
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        recipient_type, escalation_type, is_active
    )
    VALUES (@VIPRuleId, 1, 'warning_zone', 'avg_tat', -30, 'assigned_engineer', 'hierarchical', 1);

    -- Level 2: Imminent breach at 15 min before max TAT
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        recipient_type, escalation_type, is_active
    )
    VALUES (@VIPRuleId, 2, 'imminent_breach', 'max_tat', -15, 'coordinator', 'hierarchical', 1);

    -- Level 3: At breach
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        recipient_type, escalation_type, is_active
    )
    VALUES (@VIPRuleId, 3, 'breached', 'max_tat', 0, 'team_leader', 'hierarchical', 1);

    -- Level 4: Recurring breach every 30 min
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        repeat_interval_minutes, recipient_type, escalation_type, is_active
    )
    VALUES (@VIPRuleId, 4, 'recurring_breach', 'max_tat', 30, 30, 'department_head', 'hierarchical', 1);

    PRINT 'Inserted Escalation Rules for VIP Critical Override';
END

-- Default Rule Escalations
IF @DefaultRuleId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ESCALATION_RULES WHERE sla_rule_id = @DefaultRuleId)
BEGIN
    -- Level 1: Warning at 60 min before avg TAT
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        recipient_type, escalation_type, is_active
    )
    VALUES (@DefaultRuleId, 1, 'warning_zone', 'avg_tat', -60, 'assigned_engineer', 'hierarchical', 1);

    -- Level 2: Imminent breach at 30 min before max TAT
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        recipient_type, escalation_type, is_active
    )
    VALUES (@DefaultRuleId, 2, 'imminent_breach', 'max_tat', -30, 'coordinator', 'hierarchical', 1);

    -- Level 3: At breach
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        recipient_type, escalation_type, is_active
    )
    VALUES (@DefaultRuleId, 3, 'breached', 'max_tat', 0, 'team_leader', 'hierarchical', 1);

    -- Level 4: Recurring breach every 60 min
    INSERT INTO ESCALATION_RULES (
        sla_rule_id, escalation_level, trigger_type, reference_threshold, trigger_offset_minutes,
        repeat_interval_minutes, recipient_type, escalation_type, is_active
    )
    VALUES (@DefaultRuleId, 4, 'recurring_breach', 'max_tat', 60, 60, 'department_head', 'hierarchical', 1);

    PRINT 'Inserted Escalation Rules for Default SLA';
END
GO

PRINT '=============================================';
PRINT 'SLA System Migration Complete!';
PRINT '=============================================';
PRINT 'Tables created:';
PRINT '  - BUSINESS_HOURS_SCHEDULES';
PRINT '  - BUSINESS_HOURS_DETAILS';
PRINT '  - BREAK_HOURS';
PRINT '  - HOLIDAY_CALENDARS';
PRINT '  - HOLIDAY_DATES';
PRINT '  - SLA_RULES';
PRINT '  - TICKET_SLA_TRACKING';
PRINT '  - TICKET_SLA_PAUSE_LOG';
PRINT '  - ESCALATION_RULES';
PRINT '  - ESCALATION_NOTIFICATIONS_LOG';
PRINT '';
PRINT 'Columns added to TICKETS:';
PRINT '  - ticket_channel';
PRINT '  - ticket_type';
PRINT '';
PRINT 'Seed data inserted:';
PRINT '  - Standard Business Hours Schedule';
PRINT '  - 24/7 Support Schedule';
PRINT '  - India Holidays 2025';
PRINT '  - VIP Critical Override SLA Rule';
PRINT '  - Critical Assets SLA Rule';
PRINT '  - High Priority SLA Rule';
PRINT '  - Default SLA Rule';
PRINT '  - Escalation Rules';
GO
