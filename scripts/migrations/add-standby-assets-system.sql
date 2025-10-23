-- =================================================================
-- Migration: Add Standby Assets System
-- =================================================================
-- Purpose: Add support for temporary standby/loaner asset assignments
--          when user's original asset is under repair/maintenance
-- Date: 2025-10-20
-- =================================================================

USE asset_management;
GO

PRINT 'Starting migration: Add Standby Assets System...';
PRINT '';
GO

-- =================================================================
-- STEP 1: Add columns to assets table
-- =================================================================

PRINT '📦 Step 1: Adding columns to assets table...';
GO

-- Check if is_standby_asset column exists
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.assets')
    AND name = 'is_standby_asset'
)
BEGIN
    ALTER TABLE dbo.assets ADD is_standby_asset BIT NOT NULL DEFAULT 0;
    PRINT '  ✓ Added is_standby_asset column';
END
ELSE
BEGIN
    PRINT '  ⚠ is_standby_asset column already exists - skipping';
END
GO

-- Check if standby_available column exists
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.assets')
    AND name = 'standby_available'
)
BEGIN
    ALTER TABLE dbo.assets ADD standby_available BIT NOT NULL DEFAULT 1;
    PRINT '  ✓ Added standby_available column';
END
ELSE
BEGIN
    PRINT '  ⚠ standby_available column already exists - skipping';
END
GO

PRINT '';
PRINT '📋 Step 1 Complete: Assets table columns added';
PRINT '';
GO

-- =================================================================
-- STEP 2: Create STANDBY_ASSIGNMENTS table
-- =================================================================

PRINT '📦 Step 2: Creating STANDBY_ASSIGNMENTS table...';
GO

-- Drop table if exists (for clean reinstall during development)
IF OBJECT_ID('dbo.STANDBY_ASSIGNMENTS', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.STANDBY_ASSIGNMENTS;
    PRINT '  ⚠ Dropped existing STANDBY_ASSIGNMENTS table';
END
GO

CREATE TABLE dbo.STANDBY_ASSIGNMENTS (
    -- Primary Key
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

    -- User who receives the standby asset
    user_id UNIQUEIDENTIFIER NOT NULL,

    -- The standby/loaner asset being assigned
    standby_asset_id UNIQUEIDENTIFIER NOT NULL,

    -- The original asset that's under repair/maintenance (can be NULL if user has no asset)
    original_asset_id UNIQUEIDENTIFIER NULL,

    -- Reason for standby assignment
    reason VARCHAR(500) NOT NULL,
    reason_category VARCHAR(50) NOT NULL, -- 'repair', 'maintenance', 'lost', 'stolen', 'other'

    -- Assignment dates
    assigned_date DATETIME NOT NULL DEFAULT GETUTCDATE(),
    expected_return_date DATE NULL,
    actual_return_date DATETIME NULL,

    -- Assignment status
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    -- 'active': Currently assigned to user
    -- 'returned': Standby returned and user got original back
    -- 'permanent': User keeps standby permanently (original not coming back)

    -- Notes
    notes TEXT NULL,
    return_notes TEXT NULL,

    -- Audit fields
    created_by UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT GETUTCDATE(),
    returned_by UNIQUEIDENTIFIER NULL,
    returned_at DATETIME NULL,
    made_permanent_by UNIQUEIDENTIFIER NULL,
    made_permanent_at DATETIME NULL,

    -- Foreign Key Constraints
    CONSTRAINT FK_standby_assignments_user
        FOREIGN KEY (user_id)
        REFERENCES dbo.USER_MASTER(user_id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_standby_assignments_standby_asset
        FOREIGN KEY (standby_asset_id)
        REFERENCES dbo.assets(id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_standby_assignments_original_asset
        FOREIGN KEY (original_asset_id)
        REFERENCES dbo.assets(id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_standby_assignments_created_by
        FOREIGN KEY (created_by)
        REFERENCES dbo.USER_MASTER(user_id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_standby_assignments_returned_by
        FOREIGN KEY (returned_by)
        REFERENCES dbo.USER_MASTER(user_id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_standby_assignments_made_permanent_by
        FOREIGN KEY (made_permanent_by)
        REFERENCES dbo.USER_MASTER(user_id)
        ON DELETE NO ACTION,

    -- Check Constraints
    CONSTRAINT CHK_standby_status
        CHECK (status IN ('active', 'returned', 'permanent')),

    CONSTRAINT CHK_standby_reason_category
        CHECK (reason_category IN ('repair', 'maintenance', 'lost', 'stolen', 'other')),

    CONSTRAINT CHK_standby_return_date
        CHECK (actual_return_date IS NULL OR actual_return_date >= assigned_date)
);
GO

PRINT '  ✓ Created STANDBY_ASSIGNMENTS table';
PRINT '';
GO

-- =================================================================
-- STEP 3: Create indexes for performance
-- =================================================================

PRINT '📦 Step 3: Creating indexes...';
GO

-- Index on user_id for quick lookup of user's standby assignments
CREATE INDEX IDX_standby_assignments_user
    ON dbo.STANDBY_ASSIGNMENTS(user_id);
PRINT '  ✓ Created index on user_id';

-- Index on status for filtering active/returned/permanent
CREATE INDEX IDX_standby_assignments_status
    ON dbo.STANDBY_ASSIGNMENTS(status);
PRINT '  ✓ Created index on status';

-- Index on standby_asset_id for quick lookup of asset's assignment history
CREATE INDEX IDX_standby_assignments_standby_asset
    ON dbo.STANDBY_ASSIGNMENTS(standby_asset_id);
PRINT '  ✓ Created index on standby_asset_id';

-- Index on original_asset_id for tracking which assets are under repair
CREATE INDEX IDX_standby_assignments_original_asset
    ON dbo.STANDBY_ASSIGNMENTS(original_asset_id);
PRINT '  ✓ Created index on original_asset_id';

-- Index on assigned_date for chronological queries
CREATE INDEX IDX_standby_assignments_assigned_date
    ON dbo.STANDBY_ASSIGNMENTS(assigned_date DESC);
PRINT '  ✓ Created index on assigned_date';

-- Index on expected_return_date for finding assignments approaching return
CREATE INDEX IDX_standby_assignments_expected_return
    ON dbo.STANDBY_ASSIGNMENTS(expected_return_date)
    WHERE expected_return_date IS NOT NULL AND status = 'active';
PRINT '  ✓ Created filtered index on expected_return_date';

-- Composite index for active assignments by user
CREATE INDEX IDX_standby_assignments_active_user
    ON dbo.STANDBY_ASSIGNMENTS(user_id, status)
    WHERE status = 'active';
PRINT '  ✓ Created composite index on user_id + status';

PRINT '';
PRINT '📋 Step 3 Complete: All indexes created';
PRINT '';
GO

-- =================================================================
-- STEP 4: Create indexes on assets table for standby queries
-- =================================================================

PRINT '📦 Step 4: Creating indexes on assets table...';
GO

-- Index on is_standby_asset for quick filtering of standby pool
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IDX_assets_standby'
    AND object_id = OBJECT_ID('dbo.assets')
)
BEGIN
    CREATE INDEX IDX_assets_standby
        ON dbo.assets(is_standby_asset, standby_available)
        WHERE is_standby_asset = 1;
    PRINT '  ✓ Created index on is_standby_asset + standby_available';
END
ELSE
BEGIN
    PRINT '  ⚠ Index IDX_assets_standby already exists - skipping';
END
GO

PRINT '';
PRINT '📋 Step 4 Complete: Assets table indexes created';
PRINT '';
GO

-- =================================================================
-- STEP 5: Verification
-- =================================================================

PRINT '📦 Step 5: Verifying migration...';
PRINT '';
GO

-- Verify assets table columns
DECLARE @columnCount INT;
SELECT @columnCount = COUNT(*)
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.assets')
AND name IN ('is_standby_asset', 'standby_available');

IF @columnCount = 2
BEGIN
    PRINT '  ✓ Assets table columns verified';
END
ELSE
BEGIN
    PRINT '  ✗ ERROR: Assets table columns not found!';
    RAISERROR('Migration verification failed: Assets table columns', 16, 1);
END
GO

-- Verify STANDBY_ASSIGNMENTS table exists
IF OBJECT_ID('dbo.STANDBY_ASSIGNMENTS', 'U') IS NOT NULL
BEGIN
    PRINT '  ✓ STANDBY_ASSIGNMENTS table verified';
END
ELSE
BEGIN
    PRINT '  ✗ ERROR: STANDBY_ASSIGNMENTS table not found!';
    RAISERROR('Migration verification failed: STANDBY_ASSIGNMENTS table', 16, 1);
END
GO

-- Count indexes
DECLARE @indexCount INT;
SELECT @indexCount = COUNT(*)
FROM sys.indexes
WHERE object_id = OBJECT_ID('dbo.STANDBY_ASSIGNMENTS');

PRINT '  ✓ STANDBY_ASSIGNMENTS has ' + CAST(@indexCount AS VARCHAR) + ' indexes';
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Migration completed successfully!';
PRINT '';
PRINT 'Summary:';
PRINT '  • Added 2 columns to assets table';
PRINT '  • Created STANDBY_ASSIGNMENTS table';
PRINT '  • Created 7 indexes for STANDBY_ASSIGNMENTS';
PRINT '  • Created 1 index for assets table';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Implement backend API endpoints';
PRINT '  2. Create frontend UI components';
PRINT '  3. Test standby workflow';
PRINT '========================================';
GO
