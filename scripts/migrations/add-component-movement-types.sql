-- =================================================================
-- Migration: Add Component Movement Types to ASSET_MOVEMENTS
-- =================================================================
-- Purpose: Add 'component_install' and 'component_remove' to the
--          CHK_movement_type constraint to support component tracking
-- Date: 2025-10-20
-- =================================================================

USE asset_management;
GO

PRINT 'Starting migration: Add component movement types...';
GO

-- Step 1: Drop the existing CHECK constraint
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CHK_movement_type'
    AND parent_object_id = OBJECT_ID('dbo.ASSET_MOVEMENTS')
)
BEGIN
    ALTER TABLE dbo.ASSET_MOVEMENTS
    DROP CONSTRAINT CHK_movement_type;

    PRINT '✓ Dropped existing CHK_movement_type constraint';
END
ELSE
BEGIN
    PRINT '⚠ CHK_movement_type constraint not found - skipping drop';
END
GO

-- Step 2: Add the updated CHECK constraint with component movement types
ALTER TABLE dbo.ASSET_MOVEMENTS
ADD CONSTRAINT CHK_movement_type
    CHECK (movement_type IN (
        'assigned',
        'transferred',
        'returned',
        'relocated',
        'unassigned',
        'available',
        'component_install',    -- NEW: Component installation into parent asset
        'component_remove'      -- NEW: Component removal from parent asset
    ));
GO

PRINT '✓ Added updated CHK_movement_type constraint with component types';
GO

-- Step 3: Verify the constraint was created successfully
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CHK_movement_type'
    AND parent_object_id = OBJECT_ID('dbo.ASSET_MOVEMENTS')
)
BEGIN
    PRINT '✓ Verification: CHK_movement_type constraint exists';
END
ELSE
BEGIN
    PRINT '✗ ERROR: CHK_movement_type constraint was not created!';
END
GO

PRINT '';
PRINT '========================================';
PRINT 'Migration completed successfully!';
PRINT '';
PRINT 'Allowed movement_type values:';
PRINT '  - assigned';
PRINT '  - transferred';
PRINT '  - returned';
PRINT '  - relocated';
PRINT '  - unassigned';
PRINT '  - available';
PRINT '  - component_install   (NEW)';
PRINT '  - component_remove    (NEW)';
PRINT '========================================';
GO
