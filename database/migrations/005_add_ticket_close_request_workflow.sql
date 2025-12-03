-- ================================================================
-- TICKET CLOSE REQUEST WORKFLOW
-- Created: 2025-11-25
-- Description: Adds approval workflow for engineers to request
--              ticket closure that requires coordinator approval
-- ================================================================

USE asset_management;
GO

-- ================================================================
-- STEP 1: Update TICKETS table status constraint to include 'pending_closure'
-- ================================================================

PRINT 'Updating TICKETS status constraint...';

-- Drop existing constraint
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Tickets_Status')
BEGIN
    ALTER TABLE TICKETS DROP CONSTRAINT CK_Tickets_Status;
    PRINT 'Dropped existing CK_Tickets_Status constraint';
END

-- Add updated constraint with 'pending_closure' status
ALTER TABLE TICKETS
ADD CONSTRAINT CK_Tickets_Status
    CHECK (status IN ('open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled', 'pending_closure'));

PRINT 'Updated TICKETS status constraint to include pending_closure';
GO

-- ================================================================
-- STEP 2: Create TICKET_CLOSE_REQUESTS table
-- Tracks engineer requests to close tickets and coordinator approval
-- ================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TICKET_CLOSE_REQUESTS')
BEGIN
    CREATE TABLE TICKET_CLOSE_REQUESTS (
        -- Primary Key
        close_request_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Foreign Keys
        ticket_id UNIQUEIDENTIFIER NOT NULL,
        requested_by_engineer_id UNIQUEIDENTIFIER NOT NULL,
        reviewed_by_coordinator_id UNIQUEIDENTIFIER NULL,

        -- Request Data
        request_notes NVARCHAR(MAX) NOT NULL,          -- Engineer's resolution notes
        request_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected

        -- Coordinator Review
        review_notes NVARCHAR(MAX) NULL,               -- Coordinator's feedback
        reviewed_at DATETIME NULL,

        -- Timestamps
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        -- Foreign Key Constraints
        CONSTRAINT FK_CloseRequests_Ticket
            FOREIGN KEY (ticket_id) REFERENCES TICKETS(ticket_id) ON DELETE CASCADE,
        CONSTRAINT FK_CloseRequests_Engineer
            FOREIGN KEY (requested_by_engineer_id) REFERENCES USER_MASTER(user_id),
        CONSTRAINT FK_CloseRequests_Coordinator
            FOREIGN KEY (reviewed_by_coordinator_id) REFERENCES USER_MASTER(user_id),

        -- Check Constraints
        CONSTRAINT CK_CloseRequests_Status
            CHECK (request_status IN ('pending', 'approved', 'rejected'))
    );

    PRINT 'Table TICKET_CLOSE_REQUESTS created successfully';
END
ELSE
BEGIN
    PRINT 'Table TICKET_CLOSE_REQUESTS already exists';
END
GO

-- ================================================================
-- STEP 3: Create indexes for TICKET_CLOSE_REQUESTS
-- ================================================================

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CloseRequests_Ticket')
    CREATE INDEX IX_CloseRequests_Ticket ON TICKET_CLOSE_REQUESTS(ticket_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CloseRequests_Engineer')
    CREATE INDEX IX_CloseRequests_Engineer ON TICKET_CLOSE_REQUESTS(requested_by_engineer_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CloseRequests_Coordinator')
    CREATE INDEX IX_CloseRequests_Coordinator ON TICKET_CLOSE_REQUESTS(reviewed_by_coordinator_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CloseRequests_Status')
    CREATE INDEX IX_CloseRequests_Status ON TICKET_CLOSE_REQUESTS(request_status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CloseRequests_CreatedAt')
    CREATE INDEX IX_CloseRequests_CreatedAt ON TICKET_CLOSE_REQUESTS(created_at DESC);

PRINT 'Indexes for TICKET_CLOSE_REQUESTS created successfully';
GO

-- ================================================================
-- STEP 4: Create trigger for auto-updating updated_at timestamp
-- ================================================================

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_CloseRequests_UpdateTimestamp')
    DROP TRIGGER trg_CloseRequests_UpdateTimestamp;
GO

CREATE TRIGGER trg_CloseRequests_UpdateTimestamp
ON TICKET_CLOSE_REQUESTS
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE cr
    SET updated_at = GETDATE()
    FROM TICKET_CLOSE_REQUESTS cr
    INNER JOIN inserted i ON cr.close_request_id = i.close_request_id;
END
GO

PRINT 'Trigger trg_CloseRequests_UpdateTimestamp created successfully';
GO

-- ================================================================
-- VERIFICATION QUERIES
-- ================================================================

PRINT '';
PRINT '================================================================';
PRINT 'TICKET CLOSE REQUEST WORKFLOW SETUP COMPLETE!';
PRINT '================================================================';
PRINT '';
PRINT 'Changes Made:';
PRINT '  1. Updated TICKETS status constraint to include pending_closure';
PRINT '  2. Created TICKET_CLOSE_REQUESTS table';
PRINT '  3. Created indexes for performance optimization';
PRINT '  4. Created trigger for auto-update timestamps';
PRINT '';
PRINT 'New Workflow:';
PRINT '  Engineer -> Request Close (pending_closure)';
PRINT '  Coordinator -> Approve/Reject';
PRINT '  If Approved -> Ticket Closed';
PRINT '  If Rejected -> Ticket returns to in_progress';
PRINT '';
PRINT 'Verification:';

SELECT 'TICKET_CLOSE_REQUESTS' AS TableName, COUNT(*) AS RecordCount
FROM TICKET_CLOSE_REQUESTS;

PRINT '';
PRINT 'Migration complete!';
PRINT '================================================================';
GO
