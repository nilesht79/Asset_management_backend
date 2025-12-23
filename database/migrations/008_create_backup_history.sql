-- =====================================================
-- BACKUP HISTORY TABLE
-- Track all database backups performed by the system
-- =====================================================

USE asset_management;
GO

-- Create BACKUP_HISTORY table if not exists
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='BACKUP_HISTORY' AND xtype='U')
BEGIN
    CREATE TABLE BACKUP_HISTORY (
        backup_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        created_at DATETIME2 DEFAULT GETDATE() NOT NULL,

        database_name NVARCHAR(100) NOT NULL,
        backup_type NVARCHAR(20) NOT NULL,        -- full, differential, transactionLog

        filename NVARCHAR(500) NULL,
        file_path NVARCHAR(1000) NULL,
        file_size BIGINT NULL,                    -- Size in bytes

        duration_ms INT NULL,
        status NVARCHAR(20) NOT NULL,             -- success, failed
        error_message NVARCHAR(MAX) NULL,

        verified BIT DEFAULT 0,
        uploaded_to_cloud BIT DEFAULT 0,
        cloud_path NVARCHAR(1000) NULL,

        -- Indexes
        INDEX IX_BACKUP_HISTORY_created_at (created_at DESC),
        INDEX IX_BACKUP_HISTORY_database (database_name),
        INDEX IX_BACKUP_HISTORY_type (backup_type),
        INDEX IX_BACKUP_HISTORY_status (status)
    );

    PRINT 'Created BACKUP_HISTORY table';
END
GO

-- Create view for recent backups
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_RecentBackups')
    DROP VIEW vw_RecentBackups;
GO

CREATE VIEW vw_RecentBackups
AS
SELECT TOP 50
    backup_id,
    created_at,
    database_name,
    backup_type,
    filename,
    file_size,
    duration_ms,
    status,
    verified,
    uploaded_to_cloud
FROM BACKUP_HISTORY
ORDER BY created_at DESC;
GO

PRINT 'Created vw_RecentBackups view';
GO

-- Create view for backup health status
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_BackupHealth')
    DROP VIEW vw_BackupHealth;
GO

CREATE VIEW vw_BackupHealth
AS
SELECT
    database_name,
    MAX(CASE WHEN backup_type = 'full' AND status = 'success' THEN created_at END) AS last_full_backup,
    MAX(CASE WHEN backup_type = 'differential' AND status = 'success' THEN created_at END) AS last_diff_backup,
    MAX(CASE WHEN backup_type = 'transactionLog' AND status = 'success' THEN created_at END) AS last_log_backup,
    COUNT(CASE WHEN status = 'failed' AND created_at > DATEADD(DAY, -7, GETDATE()) THEN 1 END) AS failed_last_7_days,
    SUM(CASE WHEN created_at > DATEADD(DAY, -30, GETDATE()) THEN file_size ELSE 0 END) AS total_size_last_30_days
FROM BACKUP_HISTORY
GROUP BY database_name;
GO

PRINT 'Created vw_BackupHealth view';
GO

-- Stored procedure to cleanup old backup history records
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_CleanupBackupHistory')
    DROP PROCEDURE sp_CleanupBackupHistory;
GO

CREATE PROCEDURE sp_CleanupBackupHistory
    @retention_days INT = 90
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM BACKUP_HISTORY
    WHERE created_at < DATEADD(DAY, -@retention_days, GETDATE());

    SELECT @@ROWCOUNT AS deleted_count;
END
GO

PRINT 'Created sp_CleanupBackupHistory procedure';
GO

PRINT '';
PRINT '=====================================================';
PRINT 'Backup History Setup Complete!';
PRINT '=====================================================';
GO
