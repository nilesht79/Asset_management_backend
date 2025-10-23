-- =================================================================
-- Asset Movement Tracking Table - Minimal Implementation
-- =================================================================
-- Purpose: Track complete history of asset assignments, transfers,
--          and location changes to populate /assets/movement route
-- =================================================================

-- Drop existing table if exists (for clean reinstall)
IF OBJECT_ID('dbo.ASSET_MOVEMENTS', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.ASSET_MOVEMENTS;
    PRINT '✓ Dropped existing ASSET_MOVEMENTS table';
END
GO

-- Create asset movements table
CREATE TABLE dbo.ASSET_MOVEMENTS (
    -- Primary Key
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

    -- Asset Information
    asset_id UNIQUEIDENTIFIER NOT NULL,
    asset_tag VARCHAR(50),  -- Denormalized for performance

    -- Assignment Information
    assigned_to UNIQUEIDENTIFIER NULL,  -- NULL = unassigned/returned
    assigned_to_name NVARCHAR(200),     -- Denormalized: first_name + last_name

    -- Location Information
    location_id UNIQUEIDENTIFIER NULL,  -- NULL if no specific location
    location_name NVARCHAR(200),        -- Denormalized for performance

    -- Movement Details
    movement_type VARCHAR(50) NOT NULL,  -- 'assigned', 'transferred', 'returned', 'relocated'
    status VARCHAR(50) NOT NULL,         -- 'assigned', 'available', 'maintenance', etc.

    -- Previous State (for context)
    previous_user_id UNIQUEIDENTIFIER NULL,
    previous_user_name NVARCHAR(200),
    previous_location_id UNIQUEIDENTIFIER NULL,
    previous_location_name NVARCHAR(200),

    -- Timing
    movement_date DATETIME NOT NULL DEFAULT GETUTCDATE(),

    -- Reasoning & Audit
    reason TEXT,                        -- Why this movement occurred
    notes TEXT,                         -- Additional notes
    performed_by UNIQUEIDENTIFIER NOT NULL,  -- User who performed the action
    performed_by_name NVARCHAR(200),    -- Denormalized

    -- Metadata
    created_at DATETIME NOT NULL DEFAULT GETUTCDATE(),

    -- Foreign Key Constraints
    CONSTRAINT FK_movements_asset
        FOREIGN KEY (asset_id)
        REFERENCES dbo.ASSETS(id)
        ON DELETE CASCADE,

    CONSTRAINT FK_movements_user
        FOREIGN KEY (assigned_to)
        REFERENCES dbo.USER_MASTER(user_id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_movements_location
        FOREIGN KEY (location_id)
        REFERENCES dbo.LOCATIONS(id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_movements_performer
        FOREIGN KEY (performed_by)
        REFERENCES dbo.USER_MASTER(user_id)
        ON DELETE NO ACTION,

    -- Check Constraints (flexible for future expansion)
    CONSTRAINT CHK_movement_type
        CHECK (movement_type IN ('assigned', 'transferred', 'returned', 'relocated', 'unassigned', 'available', 'component_install', 'component_remove')),

    CONSTRAINT CHK_status
        CHECK (status IN ('assigned', 'available', 'maintenance', 'retired', 'lost', 'damaged', 'in-use'))
);
GO

-- =================================================================
-- Indexes for Performance
-- =================================================================

-- Index on asset_id (most common query pattern)
CREATE INDEX IDX_movements_asset
    ON dbo.ASSET_MOVEMENTS(asset_id);

-- Index on assigned_to (query user's assignment history)
CREATE INDEX IDX_movements_user
    ON dbo.ASSET_MOVEMENTS(assigned_to);

-- Index on movement_date (timeline queries)
CREATE INDEX IDX_movements_date
    ON dbo.ASSET_MOVEMENTS(movement_date DESC);

-- Composite index for asset timeline
CREATE INDEX IDX_movements_asset_date
    ON dbo.ASSET_MOVEMENTS(asset_id, movement_date DESC);

-- Index on location (query assets that moved through location)
CREATE INDEX IDX_movements_location
    ON dbo.ASSET_MOVEMENTS(location_id);

PRINT '✓ Created ASSET_MOVEMENTS table with indexes';
GO

-- =================================================================
-- Seed Initial Data (Optional)
-- =================================================================
-- Populate with current asset states as initial movements
-- This gives historical context for existing assignments

PRINT 'Seeding initial movements from current asset states...';

-- Get a system user (superadmin) to use as performer for initial seed
DECLARE @systemUserId UNIQUEIDENTIFIER;
DECLARE @systemUserName NVARCHAR(200);

SELECT TOP 1
    @systemUserId = user_id,
    @systemUserName = first_name + ' ' + last_name
FROM dbo.USER_MASTER
WHERE role = 'superadmin' AND is_active = 1
ORDER BY created_at ASC;

-- If no superadmin exists, use first admin
IF @systemUserId IS NULL
BEGIN
    SELECT TOP 1
        @systemUserId = user_id,
        @systemUserName = first_name + ' ' + last_name
    FROM dbo.USER_MASTER
    WHERE role = 'admin' AND is_active = 1
    ORDER BY created_at ASC;
END

-- If still no user, skip seeding
IF @systemUserId IS NOT NULL
BEGIN
    INSERT INTO dbo.ASSET_MOVEMENTS (
        asset_id,
        asset_tag,
        assigned_to,
        assigned_to_name,
        location_id,
        location_name,
        movement_type,
        status,
        previous_user_id,
        previous_user_name,
        previous_location_id,
        previous_location_name,
        movement_date,
        reason,
        performed_by,
        performed_by_name,
        created_at
    )
    SELECT
        a.id AS asset_id,
        a.asset_tag,
        a.assigned_to,
        CASE
            WHEN a.assigned_to IS NOT NULL
            THEN u.first_name + ' ' + u.last_name
            ELSE NULL
        END AS assigned_to_name,
        a.location_id,
        l.name AS location_name,
        CASE
            WHEN a.assigned_to IS NOT NULL THEN 'assigned'
            ELSE 'available'
        END AS movement_type,
        a.status,
        NULL AS previous_user_id,       -- No previous state for initial seed
        NULL AS previous_user_name,
        NULL AS previous_location_id,
        NULL AS previous_location_name,
        COALESCE(a.updated_at, a.created_at) AS movement_date,
        'Initial state migration' AS reason,
        @systemUserId AS performed_by,
        @systemUserName AS performed_by_name,
        GETUTCDATE() AS created_at
    FROM
        dbo.ASSETS a
        LEFT JOIN dbo.USER_MASTER u ON a.assigned_to = u.user_id
        LEFT JOIN dbo.LOCATIONS l ON a.location_id = l.id
    WHERE
        NOT EXISTS (
            SELECT 1
            FROM dbo.ASSET_MOVEMENTS m
            WHERE m.asset_id = a.id
        );
END
ELSE
BEGIN
    PRINT '⚠ No admin user found - skipping initial seed. Create movements manually.';
END

DECLARE @rowCount INT = @@ROWCOUNT;
PRINT '✓ Seeded ' + CAST(@rowCount AS VARCHAR) + ' initial movement records';
GO

-- =================================================================
-- Grant Permissions (if using role-based access)
-- =================================================================

-- Grant SELECT to all authenticated users
-- GRANT SELECT ON dbo.ASSET_MOVEMENTS TO [your_app_role];

-- Grant INSERT/UPDATE to admins only
-- GRANT INSERT, UPDATE ON dbo.ASSET_MOVEMENTS TO [admin_role];

PRINT '✓ Asset movements table setup completed successfully';
PRINT '';
PRINT '========================================';
PRINT 'Next Steps:';
PRINT '1. Run backend server to test API endpoints';
PRINT '2. Update frontend /assets/movement page';
PRINT '3. Test movement tracking with real data';
PRINT '========================================';
GO
