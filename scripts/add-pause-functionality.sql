-- ============================================================================
-- Migration: Add Pause/Resume Functionality to Reconciliation
-- Description: Adds columns and updates to support pause, resume, and
--              force-complete features for reconciliation processes
-- Date: 2025-11-08
-- ============================================================================

USE asset_management;
GO

-- Add new columns to RECONCILIATION_PROCESSES table
ALTER TABLE RECONCILIATION_PROCESSES
ADD paused_at DATETIME NULL;

ALTER TABLE RECONCILIATION_PROCESSES
ADD paused_by UNIQUEIDENTIFIER NULL;

ALTER TABLE RECONCILIATION_PROCESSES
ADD resumed_at DATETIME NULL;

ALTER TABLE RECONCILIATION_PROCESSES
ADD resumed_by UNIQUEIDENTIFIER NULL;

ALTER TABLE RECONCILIATION_PROCESSES
ADD pause_count INT NOT NULL DEFAULT 0;

ALTER TABLE RECONCILIATION_PROCESSES
ADD forced_completion BIT NOT NULL DEFAULT 0;

ALTER TABLE RECONCILIATION_PROCESSES
ADD pending_at_completion INT NULL;

-- Add foreign key constraints for user references
ALTER TABLE RECONCILIATION_PROCESSES
ADD CONSTRAINT FK_RECONCILIATION_PAUSED_BY
FOREIGN KEY (paused_by) REFERENCES USER_MASTER(user_id);

ALTER TABLE RECONCILIATION_PROCESSES
ADD CONSTRAINT FK_RECONCILIATION_RESUMED_BY
FOREIGN KEY (resumed_by) REFERENCES USER_MASTER(user_id);

-- Create index for better performance on status queries
CREATE INDEX IX_RECONCILIATION_STATUS
ON RECONCILIATION_PROCESSES(status)
WHERE is_active = 1;

-- Drop existing check constraint if it exists
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CHK_RECONCILIATION_STATUS')
BEGIN
    ALTER TABLE RECONCILIATION_PROCESSES DROP CONSTRAINT CHK_RECONCILIATION_STATUS;
    PRINT 'Dropped existing CHK_RECONCILIATION_STATUS constraint';
END

-- Add check constraint to ensure valid status values
-- Valid statuses: 'draft', 'in_progress', 'paused', 'completed', 'cancelled'
ALTER TABLE RECONCILIATION_PROCESSES
ADD CONSTRAINT CHK_RECONCILIATION_STATUS
CHECK (status IN ('draft', 'in_progress', 'paused', 'completed', 'cancelled'));

GO

-- Print completion message
PRINT 'Migration completed successfully: Pause functionality added to RECONCILIATION_PROCESSES table';
PRINT 'New columns added: paused_at, paused_by, resumed_at, resumed_by, pause_count, forced_completion, pending_at_completion';
PRINT 'New statuses supported: draft, in_progress, paused, completed, cancelled';

GO
