-- ============================================================================
-- Script: Create RECONCILIATION_DISCREPANCIES Table
-- Description: Creates table for detailed discrepancy tracking during reconciliation
-- Author: Claude Code
-- Date: 2025-10-23
-- ============================================================================

USE asset_management;
GO

-- Create RECONCILIATION_DISCREPANCIES table
CREATE TABLE RECONCILIATION_DISCREPANCIES (
    -- Primary Key
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

    -- Foreign Key to reconciliation record
    reconciliation_record_id UNIQUEIDENTIFIER NOT NULL,

    -- Field Information
    field_name VARCHAR(100) NOT NULL,              -- Technical field name (e.g., 'location', 'condition')
    field_display_name VARCHAR(200) NOT NULL,      -- User-friendly name (e.g., 'Location', 'Condition Status')

    -- Values Comparison
    system_value NVARCHAR(500) NULL,               -- What system expected
    physical_value NVARCHAR(500) NULL,             -- What was found physically

    -- Classification
    discrepancy_type VARCHAR(50) NOT NULL,         -- Type of discrepancy
    severity VARCHAR(20) NOT NULL DEFAULT 'minor', -- Severity level

    -- Resolution Tracking
    is_resolved BIT NOT NULL DEFAULT 0,            -- Whether discrepancy is resolved
    resolved_by UNIQUEIDENTIFIER NULL,             -- Who resolved it
    resolved_at DATETIME NULL,                     -- When it was resolved
    resolution_action VARCHAR(100) NULL,           -- Action taken
    resolution_notes TEXT NULL,                    -- Resolution details

    -- Metadata
    detected_by UNIQUEIDENTIFIER NOT NULL,         -- Who detected the discrepancy
    detected_at DATETIME NOT NULL DEFAULT GETUTCDATE(),
    created_at DATETIME NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME NOT NULL DEFAULT GETUTCDATE(),

    -- Foreign Key Constraints
    CONSTRAINT FK_DISCREPANCY_RECORD
        FOREIGN KEY (reconciliation_record_id)
        REFERENCES RECONCILIATION_RECORDS(id)
        ON DELETE CASCADE,

    CONSTRAINT FK_DISCREPANCY_DETECTED_BY
        FOREIGN KEY (detected_by)
        REFERENCES USER_MASTER(user_id),

    CONSTRAINT FK_DISCREPANCY_RESOLVED_BY
        FOREIGN KEY (resolved_by)
        REFERENCES USER_MASTER(user_id),

    -- Check Constraints
    CONSTRAINT CK_DISCREPANCY_TYPE CHECK (
        discrepancy_type IN (
            'location_mismatch',
            'condition_changed',
            'assignment_mismatch',
            'serial_number_mismatch',
            'asset_missing',
            'asset_damaged',
            'extra_asset',
            'status_mismatch',
            'other'
        )
    ),

    CONSTRAINT CK_DISCREPANCY_SEVERITY CHECK (
        severity IN ('critical', 'major', 'minor')
    ),

    CONSTRAINT CK_DISCREPANCY_RESOLUTION_ACTION CHECK (
        resolution_action IS NULL OR resolution_action IN (
            'updated_system',
            'updated_physical',
            'verified_correct',
            'accepted_as_is',
            'escalated'
        )
    )
);
GO

-- Create Indexes for Performance
CREATE INDEX IX_DISCREPANCY_RECORD
    ON RECONCILIATION_DISCREPANCIES(reconciliation_record_id);

CREATE INDEX IX_DISCREPANCY_TYPE
    ON RECONCILIATION_DISCREPANCIES(discrepancy_type);

CREATE INDEX IX_DISCREPANCY_SEVERITY
    ON RECONCILIATION_DISCREPANCIES(severity);

CREATE INDEX IX_DISCREPANCY_RESOLVED
    ON RECONCILIATION_DISCREPANCIES(is_resolved);

CREATE INDEX IX_DISCREPANCY_FIELD
    ON RECONCILIATION_DISCREPANCIES(field_name);

CREATE INDEX IX_DISCREPANCY_DETECTED_BY
    ON RECONCILIATION_DISCREPANCIES(detected_by);

CREATE INDEX IX_DISCREPANCY_DETECTED_AT
    ON RECONCILIATION_DISCREPANCIES(detected_at DESC);
GO

-- Add has_discrepancies column to RECONCILIATION_RECORDS for quick filtering
ALTER TABLE RECONCILIATION_RECORDS
ADD has_discrepancies BIT NOT NULL DEFAULT 0;
GO

-- Create index on has_discrepancies
CREATE INDEX IX_RECONCILIATION_HAS_DISCREPANCIES
    ON RECONCILIATION_RECORDS(has_discrepancies);
GO

PRINT 'RECONCILIATION_DISCREPANCIES table created successfully';
PRINT 'Indexes created successfully';
PRINT 'has_discrepancies column added to RECONCILIATION_RECORDS';
GO
