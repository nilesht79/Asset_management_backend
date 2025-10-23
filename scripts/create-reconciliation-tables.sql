-- =============================================
-- Inventory Reconciliation System - Database Migration
-- Description: Creates tables for inventory reconciliation feature
-- Author: System
-- Date: 2025-10-22
-- =============================================

USE asset_management;
GO

-- =============================================
-- Table 1: RECONCILIATION_PROCESSES
-- Stores reconciliation process metadata
-- =============================================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RECONCILIATION_PROCESSES')
BEGIN
    CREATE TABLE RECONCILIATION_PROCESSES (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        reconciliation_name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        -- Status values: 'draft', 'in_progress', 'completed', 'cancelled'
        created_by UNIQUEIDENTIFIER NOT NULL,
        started_by UNIQUEIDENTIFIER NULL,
        created_at DATETIME NOT NULL DEFAULT GETUTCDATE(),
        started_at DATETIME NULL,
        completed_at DATETIME NULL,
        total_assets INT NOT NULL DEFAULT 0,
        reconciled_assets INT NOT NULL DEFAULT 0,
        discrepancy_count INT NOT NULL DEFAULT 0,
        notes TEXT NULL,
        is_active BIT NOT NULL DEFAULT 1,

        CONSTRAINT FK_RECONCILIATION_CREATED_BY FOREIGN KEY (created_by)
            REFERENCES USER_MASTER(user_id),
        CONSTRAINT FK_RECONCILIATION_STARTED_BY FOREIGN KEY (started_by)
            REFERENCES USER_MASTER(user_id),
        CONSTRAINT CHK_RECONCILIATION_STATUS CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled'))
    );

    PRINT 'Table RECONCILIATION_PROCESSES created successfully.';
END
ELSE
BEGIN
    PRINT 'Table RECONCILIATION_PROCESSES already exists.';
END
GO

-- =============================================
-- Table 2: RECONCILIATION_RECORDS
-- Stores individual asset reconciliation records
-- =============================================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RECONCILIATION_RECORDS')
BEGIN
    CREATE TABLE RECONCILIATION_RECORDS (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        reconciliation_id UNIQUEIDENTIFIER NOT NULL,
        asset_id UNIQUEIDENTIFIER NOT NULL,
        reconciliation_status VARCHAR(50) NOT NULL DEFAULT 'pending',
        -- Status values: 'pending', 'verified', 'discrepancy', 'missing', 'damaged'
        physical_location VARCHAR(255) NULL,
        physical_condition VARCHAR(100) NULL,
        physical_assigned_to UNIQUEIDENTIFIER NULL,
        discrepancy_notes TEXT NULL,
        reconciled_by UNIQUEIDENTIFIER NULL,
        reconciled_at DATETIME NULL,
        system_snapshot NVARCHAR(MAX) NULL,  -- JSON data stored as string
        created_at DATETIME NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_RECONCILIATION_RECORDS_PROCESS FOREIGN KEY (reconciliation_id)
            REFERENCES RECONCILIATION_PROCESSES(id) ON DELETE CASCADE,
        CONSTRAINT FK_RECONCILIATION_RECORDS_ASSET FOREIGN KEY (asset_id)
            REFERENCES assets(id),
        CONSTRAINT FK_RECONCILIATION_RECORDS_RECONCILED_BY FOREIGN KEY (reconciled_by)
            REFERENCES USER_MASTER(user_id),
        CONSTRAINT FK_RECONCILIATION_RECORDS_PHYSICAL_ASSIGNED FOREIGN KEY (physical_assigned_to)
            REFERENCES USER_MASTER(user_id),
        CONSTRAINT CHK_RECONCILIATION_RECORD_STATUS CHECK (reconciliation_status IN
            ('pending', 'verified', 'discrepancy', 'missing', 'damaged'))
    );

    PRINT 'Table RECONCILIATION_RECORDS created successfully.';
END
ELSE
BEGIN
    PRINT 'Table RECONCILIATION_RECORDS already exists.';
END
GO

-- =============================================
-- Indexes for Performance Optimization
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_STATUS'
    AND object_id = OBJECT_ID('RECONCILIATION_PROCESSES'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_STATUS
        ON RECONCILIATION_PROCESSES(status);
    PRINT 'Index IX_RECONCILIATION_STATUS created.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_CREATED_BY'
    AND object_id = OBJECT_ID('RECONCILIATION_PROCESSES'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_CREATED_BY
        ON RECONCILIATION_PROCESSES(created_by);
    PRINT 'Index IX_RECONCILIATION_CREATED_BY created.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_CREATED_AT'
    AND object_id = OBJECT_ID('RECONCILIATION_PROCESSES'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_CREATED_AT
        ON RECONCILIATION_PROCESSES(created_at DESC);
    PRINT 'Index IX_RECONCILIATION_CREATED_AT created.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_RECORDS_PROCESS'
    AND object_id = OBJECT_ID('RECONCILIATION_RECORDS'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_RECORDS_PROCESS
        ON RECONCILIATION_RECORDS(reconciliation_id);
    PRINT 'Index IX_RECONCILIATION_RECORDS_PROCESS created.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_RECORDS_ASSET'
    AND object_id = OBJECT_ID('RECONCILIATION_RECORDS'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_RECORDS_ASSET
        ON RECONCILIATION_RECORDS(asset_id);
    PRINT 'Index IX_RECONCILIATION_RECORDS_ASSET created.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_RECORDS_STATUS'
    AND object_id = OBJECT_ID('RECONCILIATION_RECORDS'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_RECORDS_STATUS
        ON RECONCILIATION_RECORDS(reconciliation_status);
    PRINT 'Index IX_RECONCILIATION_RECORDS_STATUS created.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RECONCILIATION_RECORDS_RECONCILED_BY'
    AND object_id = OBJECT_ID('RECONCILIATION_RECORDS'))
BEGIN
    CREATE INDEX IX_RECONCILIATION_RECORDS_RECONCILED_BY
        ON RECONCILIATION_RECORDS(reconciled_by);
    PRINT 'Index IX_RECONCILIATION_RECORDS_RECONCILED_BY created.';
END
GO

-- =============================================
-- Verification Query
-- =============================================
PRINT '==============================================';
PRINT 'Reconciliation Tables Creation Complete!';
PRINT '==============================================';
PRINT '';
PRINT 'Verifying table creation...';

SELECT
    TABLE_NAME,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = t.TABLE_NAME) as COLUMN_COUNT
FROM INFORMATION_SCHEMA.TABLES t
WHERE TABLE_NAME IN ('RECONCILIATION_PROCESSES', 'RECONCILIATION_RECORDS')
ORDER BY TABLE_NAME;

PRINT '';
PRINT 'Verifying indexes...';

SELECT
    t.name AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType
FROM sys.indexes i
INNER JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('RECONCILIATION_PROCESSES', 'RECONCILIATION_RECORDS')
    AND i.name IS NOT NULL
ORDER BY t.name, i.name;

GO
