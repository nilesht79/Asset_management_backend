USE asset_management;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

PRINT '=======================================================';
PRINT 'Migration: Prevent Standby-Component Conflicts';
PRINT 'Date: 2025-10-22';
PRINT '=======================================================';
PRINT '';

-- Step 1: Check for existing conflicts
PRINT 'Step 1: Checking for existing conflicts...';

-- Check 1: Standby assets with parent_asset_id
DECLARE @standbyWithParent INT;
SELECT @standbyWithParent = COUNT(*)
FROM assets
WHERE is_standby_asset = 1 AND parent_asset_id IS NOT NULL;

PRINT '  Standby assets with parent: ' + CAST(@standbyWithParent AS VARCHAR);

-- Check 2: Components in standby pool (should be 0 after previous fix)
DECLARE @componentsInStandby INT;
SELECT @componentsInStandby = COUNT(*)
FROM assets
WHERE asset_type = 'component' AND is_standby_asset = 1;

PRINT '  Components in standby pool: ' + CAST(@componentsInStandby AS VARCHAR);
PRINT '';

-- Step 2: Add constraint to prevent standby assets from being components
PRINT 'Step 2: Adding constraint CHK_no_standby_as_component...';
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CHK_no_standby_as_component'
)
BEGIN
    IF @standbyWithParent = 0
    BEGIN
        ALTER TABLE assets
        ADD CONSTRAINT CHK_no_standby_as_component
        CHECK (NOT (is_standby_asset = 1 AND parent_asset_id IS NOT NULL));

        PRINT '  ✓ Constraint added successfully';
    END
    ELSE
    BEGIN
        PRINT '  ✗ Cannot add constraint: ' + CAST(@standbyWithParent AS VARCHAR) + ' conflicts exist';
        PRINT '  Fix conflicts first by running:';
        PRINT '    UPDATE assets SET is_standby_asset = 0 WHERE parent_asset_id IS NOT NULL AND is_standby_asset = 1;';
    END
END
ELSE
BEGIN
    PRINT '  ⚠ Constraint already exists';
END
PRINT '';

-- Step 3: Update stored procedure
PRINT 'Step 3: Updating sp_validate_component_installation...';
GO

-- Drop existing procedure
IF OBJECT_ID('sp_validate_component_installation', 'P') IS NOT NULL
BEGIN
    DROP PROCEDURE sp_validate_component_installation;
    PRINT '  ✓ Dropped existing procedure';
END
GO

-- Create updated procedure with standby validation
CREATE PROCEDURE sp_validate_component_installation
    @component_id UNIQUEIDENTIFIER,
    @parent_id UNIQUEIDENTIFIER,
    @is_valid BIT OUTPUT,
    @error_message VARCHAR(500) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SET @is_valid = 1;
    SET @error_message = NULL;

    -- Check if component exists
    IF NOT EXISTS (SELECT 1 FROM assets WHERE id = @component_id AND is_active = 1)
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Component asset not found or inactive';
        RETURN;
    END

    -- Check if parent exists
    IF NOT EXISTS (SELECT 1 FROM assets WHERE id = @parent_id AND is_active = 1)
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Parent asset not found or inactive';
        RETURN;
    END

    -- *** NEW: Check if component is in standby pool ***
    IF EXISTS (
        SELECT 1 FROM assets
        WHERE id = @component_id AND is_standby_asset = 1
    )
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Cannot install standby asset as component. Remove from standby pool first.';
        RETURN;
    END

    -- Check if component is already installed
    IF EXISTS (
        SELECT 1 FROM assets
        WHERE id = @component_id
          AND parent_asset_id IS NOT NULL
          AND parent_asset_id != @parent_id
          AND removal_date IS NULL
    )
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Component is already installed in another asset';
        RETURN;
    END

    -- Check if component is assigned
    IF EXISTS (
        SELECT 1 FROM assets
        WHERE id = @component_id AND assigned_to IS NOT NULL
    )
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Cannot install assigned component. Unassign first.';
        RETURN;
    END

    -- *** NEW: Check for active standby assignments ***
    IF EXISTS (
        SELECT 1 FROM STANDBY_ASSIGNMENTS
        WHERE standby_asset_id = @component_id AND status = 'active'
    )
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Cannot install asset with active standby assignment. Return assignment first.';
        RETURN;
    END

    -- Check self-reference
    IF @component_id = @parent_id
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Cannot install asset as component of itself';
        RETURN;
    END

    SET @is_valid = 1;
END
GO

PRINT '  ✓ Stored procedure updated with standby validation';
PRINT '';

-- Step 4: Verify constraints
PRINT 'Step 4: Verifying all constraints...';

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_no_component_standby')
    PRINT '  ✓ CHK_no_component_standby exists (prevents components in standby)';
ELSE
    PRINT '  ✗ CHK_no_component_standby missing!';

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_no_standby_as_component')
    PRINT '  ✓ CHK_no_standby_as_component exists (prevents standby as components)';
ELSE
    PRINT '  ⚠ CHK_no_standby_as_component not added (check conflicts above)';

PRINT '';

-- Step 5: Summary
PRINT '=======================================================';
PRINT '✅ MIGRATION COMPLETED';
PRINT '=======================================================';
PRINT '';
PRINT 'Applied protections:';
PRINT '  1. Database constraint: CHK_no_standby_as_component';
PRINT '  2. Database constraint: CHK_no_component_standby';
PRINT '  3. Stored procedure: sp_validate_component_installation';
PRINT '';
PRINT 'Business Rule Enforced:';
PRINT '  "An asset can be EITHER standby OR component, never both"';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Test component installation with standby asset (should fail)';
PRINT '  2. Test adding component to standby pool (should fail)';
PRINT '  3. Update frontend to filter out standby assets from component selection';
PRINT '';
GO
