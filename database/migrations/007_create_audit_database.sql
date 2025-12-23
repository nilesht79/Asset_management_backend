-- =====================================================
-- AUDIT DATABASE SCHEMA
-- Comprehensive audit logging for the ITSM Platform
-- Run this script on the SQL Server instance
-- =====================================================

-- Create the audit database if it doesn't exist
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'audit_logs')
BEGIN
    CREATE DATABASE audit_logs;
    PRINT 'Created audit_logs database';
END
GO

USE audit_logs;
GO

-- =====================================================
-- AUDIT_LOGS - Main audit log table
-- =====================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AUDIT_LOGS' AND xtype='U')
BEGIN
    CREATE TABLE AUDIT_LOGS (
        audit_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Timestamp
        created_at DATETIME2 DEFAULT GETDATE() NOT NULL,

        -- Request Context
        request_id NVARCHAR(100) NULL,              -- Correlation ID for tracking
        session_id NVARCHAR(100) NULL,              -- User session ID

        -- User Information
        user_id UNIQUEIDENTIFIER NULL,              -- User who performed the action
        user_email NVARCHAR(255) NULL,              -- User email (denormalized for queries)
        user_role NVARCHAR(50) NULL,                -- User role at time of action
        user_department_id UNIQUEIDENTIFIER NULL,   -- User's department

        -- Action Details
        action NVARCHAR(100) NOT NULL,              -- Action performed (e.g., 'asset_created', 'login_success')
        action_category NVARCHAR(50) NOT NULL,      -- Category (auth, asset, ticket, user, etc.)
        action_type NVARCHAR(20) NOT NULL,          -- Type: CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, etc.

        -- Resource Information
        resource_type NVARCHAR(100) NULL,           -- Type of resource (asset, ticket, user, etc.)
        resource_id NVARCHAR(100) NULL,             -- ID of the resource affected
        resource_name NVARCHAR(500) NULL,           -- Human-readable name/identifier

        -- HTTP Request Details
        http_method NVARCHAR(10) NULL,              -- GET, POST, PUT, DELETE, PATCH
        endpoint NVARCHAR(500) NULL,                -- API endpoint path
        query_params NVARCHAR(MAX) NULL,            -- Query parameters (JSON)

        -- Client Information
        ip_address NVARCHAR(50) NULL,               -- Client IP address
        user_agent NVARCHAR(1000) NULL,             -- Browser/client user agent
        client_type NVARCHAR(50) NULL,              -- web, mobile, api, system

        -- Change Tracking
        old_value NVARCHAR(MAX) NULL,               -- Previous value (JSON)
        new_value NVARCHAR(MAX) NULL,               -- New value (JSON)
        changed_fields NVARCHAR(MAX) NULL,          -- List of changed field names (JSON array)

        -- Status & Error Information
        status NVARCHAR(20) NOT NULL DEFAULT 'success', -- success, failure, error
        status_code INT NULL,                       -- HTTP status code
        error_message NVARCHAR(MAX) NULL,           -- Error message if failed
        error_code NVARCHAR(50) NULL,               -- Application error code

        -- Performance
        duration_ms INT NULL,                       -- Request duration in milliseconds

        -- Additional Context
        metadata NVARCHAR(MAX) NULL,                -- Additional JSON metadata
        reason NVARCHAR(500) NULL,                  -- Reason/justification for action

        -- Source Information
        source_system NVARCHAR(50) DEFAULT 'api',   -- api, scheduler, webhook, system
        api_version NVARCHAR(20) NULL,              -- API version used

        -- Indexes will be created separately
        INDEX IX_AUDIT_LOGS_created_at (created_at DESC),
        INDEX IX_AUDIT_LOGS_user_id (user_id),
        INDEX IX_AUDIT_LOGS_action (action),
        INDEX IX_AUDIT_LOGS_action_category (action_category),
        INDEX IX_AUDIT_LOGS_resource_type (resource_type),
        INDEX IX_AUDIT_LOGS_resource_id (resource_id),
        INDEX IX_AUDIT_LOGS_ip_address (ip_address),
        INDEX IX_AUDIT_LOGS_status (status)
    );

    PRINT 'Created AUDIT_LOGS table';
END
GO

-- =====================================================
-- AUDIT_LOG_ARCHIVE - Archive table for old logs
-- =====================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AUDIT_LOG_ARCHIVE' AND xtype='U')
BEGIN
    CREATE TABLE AUDIT_LOG_ARCHIVE (
        audit_id UNIQUEIDENTIFIER PRIMARY KEY,
        created_at DATETIME2 NOT NULL,
        archived_at DATETIME2 DEFAULT GETDATE() NOT NULL,

        request_id NVARCHAR(100) NULL,
        session_id NVARCHAR(100) NULL,

        user_id UNIQUEIDENTIFIER NULL,
        user_email NVARCHAR(255) NULL,
        user_role NVARCHAR(50) NULL,
        user_department_id UNIQUEIDENTIFIER NULL,

        action NVARCHAR(100) NOT NULL,
        action_category NVARCHAR(50) NOT NULL,
        action_type NVARCHAR(20) NOT NULL,

        resource_type NVARCHAR(100) NULL,
        resource_id NVARCHAR(100) NULL,
        resource_name NVARCHAR(500) NULL,

        http_method NVARCHAR(10) NULL,
        endpoint NVARCHAR(500) NULL,
        query_params NVARCHAR(MAX) NULL,

        ip_address NVARCHAR(50) NULL,
        user_agent NVARCHAR(1000) NULL,
        client_type NVARCHAR(50) NULL,

        old_value NVARCHAR(MAX) NULL,
        new_value NVARCHAR(MAX) NULL,
        changed_fields NVARCHAR(MAX) NULL,

        status NVARCHAR(20) NOT NULL,
        status_code INT NULL,
        error_message NVARCHAR(MAX) NULL,
        error_code NVARCHAR(50) NULL,

        duration_ms INT NULL,
        metadata NVARCHAR(MAX) NULL,
        reason NVARCHAR(500) NULL,
        source_system NVARCHAR(50) NULL,
        api_version NVARCHAR(20) NULL,

        INDEX IX_ARCHIVE_created_at (created_at DESC),
        INDEX IX_ARCHIVE_user_id (user_id),
        INDEX IX_ARCHIVE_action_category (action_category)
    );

    PRINT 'Created AUDIT_LOG_ARCHIVE table';
END
GO

-- =====================================================
-- LOGIN_AUDIT - Dedicated login/logout tracking
-- =====================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='LOGIN_AUDIT' AND xtype='U')
BEGIN
    CREATE TABLE LOGIN_AUDIT (
        login_audit_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        created_at DATETIME2 DEFAULT GETDATE() NOT NULL,

        user_id UNIQUEIDENTIFIER NULL,
        user_email NVARCHAR(255) NULL,
        user_role NVARCHAR(50) NULL,

        event_type NVARCHAR(30) NOT NULL,           -- login_success, login_failed, logout, token_refresh, password_reset
        auth_method NVARCHAR(30) NULL,              -- password, oauth, token, sso

        ip_address NVARCHAR(50) NULL,
        user_agent NVARCHAR(1000) NULL,
        device_info NVARCHAR(500) NULL,
        location_info NVARCHAR(500) NULL,           -- GeoIP if available

        session_id NVARCHAR(100) NULL,
        token_id NVARCHAR(100) NULL,

        status NVARCHAR(20) NOT NULL DEFAULT 'success',
        failure_reason NVARCHAR(500) NULL,          -- For failed attempts

        metadata NVARCHAR(MAX) NULL,

        INDEX IX_LOGIN_AUDIT_created_at (created_at DESC),
        INDEX IX_LOGIN_AUDIT_user_id (user_id),
        INDEX IX_LOGIN_AUDIT_event_type (event_type),
        INDEX IX_LOGIN_AUDIT_ip_address (ip_address),
        INDEX IX_LOGIN_AUDIT_status (status)
    );

    PRINT 'Created LOGIN_AUDIT table';
END
GO

-- =====================================================
-- DATA_CHANGE_AUDIT - Detailed field-level changes
-- =====================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DATA_CHANGE_AUDIT' AND xtype='U')
BEGIN
    CREATE TABLE DATA_CHANGE_AUDIT (
        change_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        audit_id UNIQUEIDENTIFIER NOT NULL,         -- Links to AUDIT_LOGS
        created_at DATETIME2 DEFAULT GETDATE() NOT NULL,

        table_name NVARCHAR(100) NOT NULL,
        record_id NVARCHAR(100) NOT NULL,
        field_name NVARCHAR(100) NOT NULL,

        old_value NVARCHAR(MAX) NULL,
        new_value NVARCHAR(MAX) NULL,
        data_type NVARCHAR(50) NULL,

        INDEX IX_DATA_CHANGE_audit_id (audit_id),
        INDEX IX_DATA_CHANGE_table_name (table_name),
        INDEX IX_DATA_CHANGE_record_id (record_id),
        INDEX IX_DATA_CHANGE_created_at (created_at DESC)
    );

    PRINT 'Created DATA_CHANGE_AUDIT table';
END
GO

-- =====================================================
-- AUDIT_RETENTION_CONFIG - Retention policy settings
-- =====================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AUDIT_RETENTION_CONFIG' AND xtype='U')
BEGIN
    CREATE TABLE AUDIT_RETENTION_CONFIG (
        config_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        action_category NVARCHAR(50) NOT NULL,      -- Category or 'default'
        retention_days INT NOT NULL DEFAULT 90,     -- Days to keep in main table
        archive_days INT NOT NULL DEFAULT 365,      -- Days to keep in archive

        is_active BIT DEFAULT 1,
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),
        updated_by UNIQUEIDENTIFIER NULL,

        CONSTRAINT UQ_RETENTION_category UNIQUE(action_category)
    );

    -- Insert default retention policies
    INSERT INTO AUDIT_RETENTION_CONFIG (action_category, retention_days, archive_days)
    VALUES
        ('default', 90, 365),
        ('auth', 180, 730),          -- Keep auth logs longer (2 years)
        ('security', 365, 1825),     -- Keep security logs 5 years
        ('asset', 90, 365),
        ('ticket', 90, 365),
        ('user', 180, 730),
        ('permission', 365, 1825),   -- Keep permission changes 5 years
        ('system', 90, 365),
        ('master', 90, 365),
        ('requisition', 90, 365),
        ('file', 90, 365),
        ('job', 30, 180);            -- Job logs shorter retention

    PRINT 'Created AUDIT_RETENTION_CONFIG table with default policies';
END
GO

-- =====================================================
-- AUDIT_SUMMARY_DAILY - Daily aggregated stats
-- =====================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AUDIT_SUMMARY_DAILY' AND xtype='U')
BEGIN
    CREATE TABLE AUDIT_SUMMARY_DAILY (
        summary_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        summary_date DATE NOT NULL,

        action_category NVARCHAR(50) NOT NULL,
        action NVARCHAR(100) NULL,

        total_count INT DEFAULT 0,
        success_count INT DEFAULT 0,
        failure_count INT DEFAULT 0,

        unique_users INT DEFAULT 0,
        unique_ips INT DEFAULT 0,

        avg_duration_ms INT NULL,
        max_duration_ms INT NULL,

        created_at DATETIME2 DEFAULT GETDATE(),

        INDEX IX_SUMMARY_date (summary_date DESC),
        INDEX IX_SUMMARY_category (action_category),
        CONSTRAINT UQ_SUMMARY_daily UNIQUE(summary_date, action_category, action)
    );

    PRINT 'Created AUDIT_SUMMARY_DAILY table';
END
GO

-- =====================================================
-- Stored Procedure: Insert Audit Log
-- =====================================================
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_InsertAuditLog')
    DROP PROCEDURE sp_InsertAuditLog;
GO

CREATE PROCEDURE sp_InsertAuditLog
    @request_id NVARCHAR(100) = NULL,
    @session_id NVARCHAR(100) = NULL,
    @user_id UNIQUEIDENTIFIER = NULL,
    @user_email NVARCHAR(255) = NULL,
    @user_role NVARCHAR(50) = NULL,
    @user_department_id UNIQUEIDENTIFIER = NULL,
    @action NVARCHAR(100),
    @action_category NVARCHAR(50),
    @action_type NVARCHAR(20),
    @resource_type NVARCHAR(100) = NULL,
    @resource_id NVARCHAR(100) = NULL,
    @resource_name NVARCHAR(500) = NULL,
    @http_method NVARCHAR(10) = NULL,
    @endpoint NVARCHAR(500) = NULL,
    @query_params NVARCHAR(MAX) = NULL,
    @ip_address NVARCHAR(50) = NULL,
    @user_agent NVARCHAR(1000) = NULL,
    @client_type NVARCHAR(50) = NULL,
    @old_value NVARCHAR(MAX) = NULL,
    @new_value NVARCHAR(MAX) = NULL,
    @changed_fields NVARCHAR(MAX) = NULL,
    @status NVARCHAR(20) = 'success',
    @status_code INT = NULL,
    @error_message NVARCHAR(MAX) = NULL,
    @error_code NVARCHAR(50) = NULL,
    @duration_ms INT = NULL,
    @metadata NVARCHAR(MAX) = NULL,
    @reason NVARCHAR(500) = NULL,
    @source_system NVARCHAR(50) = 'api',
    @api_version NVARCHAR(20) = NULL,
    @audit_id UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SET @audit_id = NEWID();

    INSERT INTO AUDIT_LOGS (
        audit_id, request_id, session_id,
        user_id, user_email, user_role, user_department_id,
        action, action_category, action_type,
        resource_type, resource_id, resource_name,
        http_method, endpoint, query_params,
        ip_address, user_agent, client_type,
        old_value, new_value, changed_fields,
        status, status_code, error_message, error_code,
        duration_ms, metadata, reason,
        source_system, api_version
    )
    VALUES (
        @audit_id, @request_id, @session_id,
        @user_id, @user_email, @user_role, @user_department_id,
        @action, @action_category, @action_type,
        @resource_type, @resource_id, @resource_name,
        @http_method, @endpoint, @query_params,
        @ip_address, @user_agent, @client_type,
        @old_value, @new_value, @changed_fields,
        @status, @status_code, @error_message, @error_code,
        @duration_ms, @metadata, @reason,
        @source_system, @api_version
    );
END
GO

PRINT 'Created sp_InsertAuditLog procedure';
GO

-- =====================================================
-- Stored Procedure: Archive Old Logs
-- =====================================================
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_ArchiveAuditLogs')
    DROP PROCEDURE sp_ArchiveAuditLogs;
GO

CREATE PROCEDURE sp_ArchiveAuditLogs
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @archived_count INT = 0;
    DECLARE @deleted_count INT = 0;

    -- Move logs to archive based on retention policy
    INSERT INTO AUDIT_LOG_ARCHIVE
    SELECT
        al.audit_id, al.created_at, GETDATE() as archived_at,
        al.request_id, al.session_id,
        al.user_id, al.user_email, al.user_role, al.user_department_id,
        al.action, al.action_category, al.action_type,
        al.resource_type, al.resource_id, al.resource_name,
        al.http_method, al.endpoint, al.query_params,
        al.ip_address, al.user_agent, al.client_type,
        al.old_value, al.new_value, al.changed_fields,
        al.status, al.status_code, al.error_message, al.error_code,
        al.duration_ms, al.metadata, al.reason,
        al.source_system, al.api_version
    FROM AUDIT_LOGS al
    INNER JOIN AUDIT_RETENTION_CONFIG rc
        ON rc.action_category = al.action_category OR rc.action_category = 'default'
    WHERE al.created_at < DATEADD(DAY, -rc.retention_days, GETDATE())
    AND NOT EXISTS (SELECT 1 FROM AUDIT_LOG_ARCHIVE WHERE audit_id = al.audit_id);

    SET @archived_count = @@ROWCOUNT;

    -- Delete archived logs from main table
    DELETE al
    FROM AUDIT_LOGS al
    WHERE EXISTS (SELECT 1 FROM AUDIT_LOG_ARCHIVE WHERE audit_id = al.audit_id);

    SET @deleted_count = @@ROWCOUNT;

    -- Delete very old logs from archive
    DELETE FROM AUDIT_LOG_ARCHIVE
    WHERE created_at < DATEADD(DAY, -
        (SELECT MAX(archive_days) FROM AUDIT_RETENTION_CONFIG WHERE is_active = 1),
        GETDATE()
    );

    -- Delete old data change audit records
    DELETE FROM DATA_CHANGE_AUDIT
    WHERE created_at < DATEADD(DAY, -365, GETDATE());

    -- Delete old login audit records
    DELETE FROM LOGIN_AUDIT
    WHERE created_at < DATEADD(DAY, -
        (SELECT retention_days FROM AUDIT_RETENTION_CONFIG WHERE action_category = 'auth'),
        GETDATE()
    );

    SELECT @archived_count AS archived_count, @deleted_count AS deleted_count;
END
GO

PRINT 'Created sp_ArchiveAuditLogs procedure';
GO

-- =====================================================
-- Stored Procedure: Generate Daily Summary
-- =====================================================
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GenerateAuditSummary')
    DROP PROCEDURE sp_GenerateAuditSummary;
GO

CREATE PROCEDURE sp_GenerateAuditSummary
    @summary_date DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @summary_date IS NULL
        SET @summary_date = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE);

    -- Delete existing summary for the date
    DELETE FROM AUDIT_SUMMARY_DAILY WHERE summary_date = @summary_date;

    -- Generate summary
    INSERT INTO AUDIT_SUMMARY_DAILY (
        summary_date, action_category, action,
        total_count, success_count, failure_count,
        unique_users, unique_ips,
        avg_duration_ms, max_duration_ms
    )
    SELECT
        @summary_date,
        action_category,
        action,
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failure_count,
        COUNT(DISTINCT user_id) AS unique_users,
        COUNT(DISTINCT ip_address) AS unique_ips,
        AVG(duration_ms) AS avg_duration_ms,
        MAX(duration_ms) AS max_duration_ms
    FROM AUDIT_LOGS
    WHERE CAST(created_at AS DATE) = @summary_date
    GROUP BY action_category, action;

    SELECT @@ROWCOUNT AS summaries_created;
END
GO

PRINT 'Created sp_GenerateAuditSummary procedure';
GO

-- =====================================================
-- View: Recent Activity
-- =====================================================
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_RecentAuditActivity')
    DROP VIEW vw_RecentAuditActivity;
GO

CREATE VIEW vw_RecentAuditActivity
AS
SELECT TOP 1000
    audit_id,
    created_at,
    user_email,
    user_role,
    action,
    action_category,
    action_type,
    resource_type,
    resource_id,
    resource_name,
    http_method,
    endpoint,
    ip_address,
    status,
    status_code,
    duration_ms,
    error_message
FROM AUDIT_LOGS
ORDER BY created_at DESC;
GO

PRINT 'Created vw_RecentAuditActivity view';
GO

-- =====================================================
-- View: Failed Operations
-- =====================================================
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_FailedOperations')
    DROP VIEW vw_FailedOperations;
GO

CREATE VIEW vw_FailedOperations
AS
SELECT
    audit_id,
    created_at,
    user_email,
    user_role,
    action,
    action_category,
    resource_type,
    resource_id,
    endpoint,
    ip_address,
    status,
    status_code,
    error_message,
    error_code
FROM AUDIT_LOGS
WHERE status != 'success';
GO

PRINT 'Created vw_FailedOperations view';
GO

-- =====================================================
-- View: Security Events
-- =====================================================
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_SecurityEvents')
    DROP VIEW vw_SecurityEvents;
GO

CREATE VIEW vw_SecurityEvents
AS
SELECT
    audit_id,
    created_at,
    user_id,
    user_email,
    user_role,
    action,
    resource_type,
    resource_id,
    ip_address,
    user_agent,
    status,
    error_message,
    metadata
FROM AUDIT_LOGS
WHERE action_category IN ('auth', 'security', 'permission')
   OR action IN ('login_failed', 'unauthorized_access', 'permission_denied', 'suspicious_activity');
GO

PRINT 'Created vw_SecurityEvents view';
GO

PRINT '';
PRINT '=====================================================';
PRINT 'Audit Database Setup Complete!';
PRINT '=====================================================';
PRINT 'Tables created:';
PRINT '  - AUDIT_LOGS (main audit log)';
PRINT '  - AUDIT_LOG_ARCHIVE (archived logs)';
PRINT '  - LOGIN_AUDIT (authentication events)';
PRINT '  - DATA_CHANGE_AUDIT (field-level changes)';
PRINT '  - AUDIT_RETENTION_CONFIG (retention policies)';
PRINT '  - AUDIT_SUMMARY_DAILY (aggregated stats)';
PRINT '';
PRINT 'Stored Procedures:';
PRINT '  - sp_InsertAuditLog';
PRINT '  - sp_ArchiveAuditLogs';
PRINT '  - sp_GenerateAuditSummary';
PRINT '';
PRINT 'Views:';
PRINT '  - vw_RecentAuditActivity';
PRINT '  - vw_FailedOperations';
PRINT '  - vw_SecurityEvents';
PRINT '=====================================================';
GO
