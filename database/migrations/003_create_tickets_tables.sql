-- ================================================================
-- TICKET MANAGEMENT SYSTEM - DATABASE SCHEMA
-- Created: 2025-01-13
-- Description: Ticket system for coordinators to create and manage
--              support tickets on behalf of employees
-- ================================================================

USE asset_management;
GO

-- ================================================================
-- TABLE 1: TICKETS
-- Main table storing all ticket information
-- Department and Location are inherited from created_by_user_id
-- ================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TICKETS')
BEGIN
    CREATE TABLE TICKETS (
        -- Primary Key
        ticket_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ticket_number VARCHAR(20) UNIQUE NOT NULL,

        -- Ticket Information
        title NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX),

        -- Status & Priority
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',

        -- User Relationships (Foreign Keys to USER_MASTER)
        created_by_user_id UNIQUEIDENTIFIER NOT NULL,        -- Employee who needs help
        created_by_coordinator_id UNIQUEIDENTIFIER NOT NULL, -- Coordinator who created ticket
        assigned_to_engineer_id UNIQUEIDENTIFIER NULL,       -- Engineer assigned to ticket

        -- Department & Location (Inherited from created_by_user_id)
        department_id UNIQUEIDENTIFIER NULL,
        location_id UNIQUEIDENTIFIER NULL,

        -- Metadata
        category NVARCHAR(100) NULL,
        due_date DATETIME NULL,
        resolved_at DATETIME NULL,
        closed_at DATETIME NULL,
        resolution_notes NVARCHAR(MAX) NULL,

        -- Timestamps
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        -- Foreign Key Constraints
        CONSTRAINT FK_Tickets_CreatedByUser
            FOREIGN KEY (created_by_user_id) REFERENCES USER_MASTER(user_id),
        CONSTRAINT FK_Tickets_CreatedByCoordinator
            FOREIGN KEY (created_by_coordinator_id) REFERENCES USER_MASTER(user_id),
        CONSTRAINT FK_Tickets_AssignedToEngineer
            FOREIGN KEY (assigned_to_engineer_id) REFERENCES USER_MASTER(user_id),
        CONSTRAINT FK_Tickets_Department
            FOREIGN KEY (department_id) REFERENCES DEPARTMENT_MASTER(department_id),
        CONSTRAINT FK_Tickets_Location
            FOREIGN KEY (location_id) REFERENCES locations(id),

        -- Check Constraints
        CONSTRAINT CK_Tickets_Status
            CHECK (status IN ('open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled')),
        CONSTRAINT CK_Tickets_Priority
            CHECK (priority IN ('low', 'medium', 'high', 'critical', 'emergency'))
    );

    PRINT 'Table TICKETS created successfully';
END
ELSE
BEGIN
    PRINT 'Table TICKETS already exists';
END
GO

-- ================================================================
-- TABLE 2: TICKET_COMMENTS
-- Stores comments/notes on tickets
-- ================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TICKET_COMMENTS')
BEGIN
    CREATE TABLE TICKET_COMMENTS (
        -- Primary Key
        comment_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Foreign Keys
        ticket_id UNIQUEIDENTIFIER NOT NULL,
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Comment Data
        comment_text NVARCHAR(MAX) NOT NULL,
        is_internal BIT NOT NULL DEFAULT 0, -- Internal notes visible only to staff

        -- Timestamps
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),

        -- Foreign Key Constraints
        CONSTRAINT FK_TicketComments_Ticket
            FOREIGN KEY (ticket_id) REFERENCES TICKETS(ticket_id) ON DELETE CASCADE,
        CONSTRAINT FK_TicketComments_User
            FOREIGN KEY (user_id) REFERENCES USER_MASTER(user_id)
    );

    PRINT 'Table TICKET_COMMENTS created successfully';
END
ELSE
BEGIN
    PRINT 'Table TICKET_COMMENTS already exists';
END
GO

-- ================================================================
-- TABLE 3: TICKET_ATTACHMENTS
-- Stores file attachments for tickets
-- ================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TICKET_ATTACHMENTS')
BEGIN
    CREATE TABLE TICKET_ATTACHMENTS (
        -- Primary Key
        attachment_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Foreign Keys
        ticket_id UNIQUEIDENTIFIER NOT NULL,
        uploaded_by_user_id UNIQUEIDENTIFIER NOT NULL,

        -- File Information
        file_name NVARCHAR(255) NOT NULL,
        file_path NVARCHAR(500) NOT NULL,
        file_type VARCHAR(50) NULL,
        file_size BIGINT NULL,

        -- Timestamps
        created_at DATETIME NOT NULL DEFAULT GETDATE(),

        -- Foreign Key Constraints
        CONSTRAINT FK_TicketAttachments_Ticket
            FOREIGN KEY (ticket_id) REFERENCES TICKETS(ticket_id) ON DELETE CASCADE,
        CONSTRAINT FK_TicketAttachments_User
            FOREIGN KEY (uploaded_by_user_id) REFERENCES USER_MASTER(user_id)
    );

    PRINT 'Table TICKET_ATTACHMENTS created successfully';
END
ELSE
BEGIN
    PRINT 'Table TICKET_ATTACHMENTS already exists';
END
GO

-- ================================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION
-- ================================================================

-- TICKETS Table Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_TicketNumber')
    CREATE UNIQUE INDEX IX_Tickets_TicketNumber ON TICKETS(ticket_number);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_Status')
    CREATE INDEX IX_Tickets_Status ON TICKETS(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_Priority')
    CREATE INDEX IX_Tickets_Priority ON TICKETS(priority);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_CreatedByUser')
    CREATE INDEX IX_Tickets_CreatedByUser ON TICKETS(created_by_user_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_CreatedByCoordinator')
    CREATE INDEX IX_Tickets_CreatedByCoordinator ON TICKETS(created_by_coordinator_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_AssignedEngineer')
    CREATE INDEX IX_Tickets_AssignedEngineer ON TICKETS(assigned_to_engineer_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_Department')
    CREATE INDEX IX_Tickets_Department ON TICKETS(department_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_Location')
    CREATE INDEX IX_Tickets_Location ON TICKETS(location_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_CreatedAt')
    CREATE INDEX IX_Tickets_CreatedAt ON TICKETS(created_at DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tickets_DueDate')
    CREATE INDEX IX_Tickets_DueDate ON TICKETS(due_date);

-- TICKET_COMMENTS Table Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TicketComments_Ticket')
    CREATE INDEX IX_TicketComments_Ticket ON TICKET_COMMENTS(ticket_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TicketComments_User')
    CREATE INDEX IX_TicketComments_User ON TICKET_COMMENTS(user_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TicketComments_CreatedAt')
    CREATE INDEX IX_TicketComments_CreatedAt ON TICKET_COMMENTS(created_at DESC);

-- TICKET_ATTACHMENTS Table Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TicketAttachments_Ticket')
    CREATE INDEX IX_TicketAttachments_Ticket ON TICKET_ATTACHMENTS(ticket_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TicketAttachments_User')
    CREATE INDEX IX_TicketAttachments_User ON TICKET_ATTACHMENTS(uploaded_by_user_id);

PRINT 'All indexes created successfully';
GO

-- ================================================================
-- SEQUENCE FOR TICKET NUMBER GENERATION
-- Creates sequential ticket numbers: TKT-2025-0001, TKT-2025-0002, etc.
-- ================================================================

IF NOT EXISTS (SELECT * FROM sys.sequences WHERE name = 'SEQ_TicketNumber')
BEGIN
    CREATE SEQUENCE SEQ_TicketNumber
        START WITH 1
        INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 999999
        CYCLE;

    PRINT 'Sequence SEQ_TicketNumber created successfully';
END
ELSE
BEGIN
    PRINT 'Sequence SEQ_TicketNumber already exists';
END
GO

-- ================================================================
-- STORED PROCEDURE: Generate Ticket Number
-- Format: TKT-YYYY-NNNN (e.g., TKT-2025-0001)
-- ================================================================

IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GenerateTicketNumber')
    DROP PROCEDURE sp_GenerateTicketNumber;
GO

CREATE PROCEDURE sp_GenerateTicketNumber
    @TicketNumber VARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Year VARCHAR(4);
    DECLARE @SeqNumber INT;

    -- Get current year
    SET @Year = CAST(YEAR(GETDATE()) AS VARCHAR(4));

    -- Get next sequence number
    SET @SeqNumber = NEXT VALUE FOR SEQ_TicketNumber;

    -- Format: TKT-YYYY-NNNN (e.g., TKT-2025-0001)
    SET @TicketNumber = 'TKT-' + @Year + '-' + RIGHT('0000' + CAST(@SeqNumber AS VARCHAR(4)), 4);

    -- Check if ticket number already exists (handle year rollover)
    WHILE EXISTS (SELECT 1 FROM TICKETS WHERE ticket_number = @TicketNumber)
    BEGIN
        SET @SeqNumber = NEXT VALUE FOR SEQ_TicketNumber;
        SET @TicketNumber = 'TKT-' + @Year + '-' + RIGHT('0000' + CAST(@SeqNumber AS VARCHAR(4)), 4);
    END
END
GO

PRINT 'Stored procedure sp_GenerateTicketNumber created successfully';
GO

-- ================================================================
-- TRIGGER: Auto-update updated_at timestamp on TICKETS
-- ================================================================

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_Tickets_UpdateTimestamp')
    DROP TRIGGER trg_Tickets_UpdateTimestamp;
GO

CREATE TRIGGER trg_Tickets_UpdateTimestamp
ON TICKETS
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE t
    SET updated_at = GETDATE()
    FROM TICKETS t
    INNER JOIN inserted i ON t.ticket_id = i.ticket_id;
END
GO

PRINT 'Trigger trg_Tickets_UpdateTimestamp created successfully';
GO

-- ================================================================
-- TRIGGER: Auto-update updated_at timestamp on TICKET_COMMENTS
-- ================================================================

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_TicketComments_UpdateTimestamp')
    DROP TRIGGER trg_TicketComments_UpdateTimestamp;
GO

CREATE TRIGGER trg_TicketComments_UpdateTimestamp
ON TICKET_COMMENTS
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE tc
    SET updated_at = GETDATE()
    FROM TICKET_COMMENTS tc
    INNER JOIN inserted i ON tc.comment_id = i.comment_id;
END
GO

PRINT 'Trigger trg_TicketComments_UpdateTimestamp created successfully';
GO

-- ================================================================
-- SAMPLE DATA (Optional - for testing)
-- ================================================================

-- Uncomment the following to insert sample data for testing

/*
-- Note: Replace UUIDs with actual user_ids from your USER_MASTER table
DECLARE @SampleEmployeeId UNIQUEIDENTIFIER;
DECLARE @SampleCoordinatorId UNIQUEIDENTIFIER;
DECLARE @SampleEngineerId UNIQUEIDENTIFIER;
DECLARE @SampleDeptId UNIQUEIDENTIFIER;
DECLARE @SampleLocationId UNIQUEIDENTIFIER;
DECLARE @TicketNumber VARCHAR(20);

-- Get sample users
SELECT TOP 1 @SampleEmployeeId = user_id FROM USER_MASTER WHERE role = 'employee' AND is_active = 1;
SELECT TOP 1 @SampleCoordinatorId = user_id FROM USER_MASTER WHERE role = 'coordinator' AND is_active = 1;
SELECT TOP 1 @SampleEngineerId = user_id FROM USER_MASTER WHERE role = 'engineer' AND is_active = 1;
SELECT TOP 1 @SampleDeptId = department_id FROM DEPARTMENT_MASTER;
SELECT TOP 1 @SampleLocationId = location_id FROM locations;

-- Generate ticket number
EXEC sp_GenerateTicketNumber @TicketNumber OUTPUT;

-- Insert sample ticket
INSERT INTO TICKETS (
    ticket_id, ticket_number, title, description,
    status, priority,
    created_by_user_id, created_by_coordinator_id, assigned_to_engineer_id,
    department_id, location_id,
    category, created_at
)
VALUES (
    NEWID(), @TicketNumber,
    'Laptop not turning on',
    'Employee laptop is not powering on. Power button does not respond.',
    'open', 'high',
    @SampleEmployeeId, @SampleCoordinatorId, @SampleEngineerId,
    @SampleDeptId, @SampleLocationId,
    'Hardware', GETDATE()
);

PRINT 'Sample data inserted successfully';
*/

-- ================================================================
-- VERIFICATION QUERIES
-- ================================================================

PRINT '';
PRINT '================================================================';
PRINT 'TICKET SYSTEM TABLES CREATED SUCCESSFULLY!';
PRINT '================================================================';
PRINT '';
PRINT 'Created Tables:';
PRINT '  1. TICKETS';
PRINT '  2. TICKET_COMMENTS';
PRINT '  3. TICKET_ATTACHMENTS';
PRINT '';
PRINT 'Created Objects:';
PRINT '  - Indexes for performance optimization';
PRINT '  - Sequence: SEQ_TicketNumber';
PRINT '  - Stored Procedure: sp_GenerateTicketNumber';
PRINT '  - Triggers: Auto-update timestamps';
PRINT '';
PRINT 'Verification:';

SELECT 'TICKETS' AS TableName, COUNT(*) AS RecordCount FROM TICKETS
UNION ALL
SELECT 'TICKET_COMMENTS', COUNT(*) FROM TICKET_COMMENTS
UNION ALL
SELECT 'TICKET_ATTACHMENTS', COUNT(*) FROM TICKET_ATTACHMENTS;

PRINT '';
PRINT 'Setup complete! Ready to create backend models and controllers.';
PRINT '================================================================';
GO
