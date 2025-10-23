USE asset_management;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

PRINT '=======================================================';
PRINT 'Fix: Remove Components from Standby Pool';
PRINT 'Date: 2025-10-22';
PRINT '=======================================================';
PRINT '';

-- Step 1: Identify affected records
PRINT 'Step 1: Identifying affected records...';
DECLARE @affectedCount INT;

SELECT @affectedCount = COUNT(*)
FROM assets
WHERE asset_type = 'component' AND is_standby_asset = 1;

PRINT '  Found ' + CAST(@affectedCount AS VARCHAR) + ' component(s) marked as standby';
PRINT '';

IF @affectedCount = 0
BEGIN
    PRINT '  ✓ No components in standby pool. Nothing to fix.';
    PRINT '';
END
ELSE
BEGIN
    -- Step 2: Show affected assets
    PRINT 'Step 2: Affected assets:';
    SELECT
        asset_tag,
        asset_type,
        is_standby_asset,
        parent_asset_id,
        status
    FROM assets
    WHERE asset_type = 'component' AND is_standby_asset = 1;
    PRINT '';

    -- Step 3: Check for active assignments
    PRINT 'Step 3: Checking for active standby assignments...';
    DECLARE @hasActiveAssignments INT;

    SELECT @hasActiveAssignments = COUNT(*)
    FROM STANDBY_ASSIGNMENTS sa
    INNER JOIN assets a ON sa.standby_asset_id = a.id
    WHERE a.asset_type = 'component'
      AND a.is_standby_asset = 1
      AND sa.status = 'active';

    IF @hasActiveAssignments > 0
    BEGIN
        PRINT '  ✗ ERROR: Found ' + CAST(@hasActiveAssignments AS VARCHAR) + ' active assignments!';
        PRINT '  Cannot proceed. Manual intervention required.';
        PRINT '';
        RAISERROR('Components with active standby assignments found', 16, 1);
        RETURN;
    END
    ELSE
    BEGIN
        PRINT '  ✓ No active assignments found. Safe to proceed.';
        PRINT '';
    END

    -- Step 4: Apply fix
    PRINT 'Step 4: Applying fix...';
    BEGIN TRANSACTION;

    BEGIN TRY
        UPDATE assets
        SET
            is_standby_asset = 0,
            standby_available = 1,
            updated_at = GETUTCDATE()
        WHERE asset_type = 'component'
          AND is_standby_asset = 1;

        PRINT '  ✓ Updated ' + CAST(@@ROWCOUNT AS VARCHAR) + ' record(s)';

        COMMIT TRANSACTION;
        PRINT '  ✓ Transaction committed';
        PRINT '';
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        PRINT '  ✗ ERROR: ' + ERROR_MESSAGE();
        PRINT '  Transaction rolled back';
        PRINT '';
        THROW;
    END CATCH
END

-- Step 5: Add constraint
PRINT 'Step 5: Adding prevention constraint...';
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CHK_no_component_standby'
)
BEGIN
    ALTER TABLE assets
    ADD CONSTRAINT CHK_no_component_standby
    CHECK (NOT (asset_type = 'component' AND is_standby_asset = 1));

    PRINT '  ✓ Constraint CHK_no_component_standby added';
END
ELSE
BEGIN
    PRINT '  ⚠ Constraint already exists (skipping)';
END
PRINT '';

-- Step 6: Verify fix
PRINT 'Step 6: Verification...';
DECLARE @remainingCount INT;

SELECT @remainingCount = COUNT(*)
FROM assets
WHERE asset_type = 'component' AND is_standby_asset = 1;

IF @remainingCount = 0
BEGIN
    PRINT '  ✓ No components in standby pool';
    PRINT '';
    PRINT '=======================================================';
    PRINT '✅ FIX COMPLETED SUCCESSFULLY';
    PRINT '=======================================================';
END
ELSE
BEGIN
    PRINT '  ✗ Still found ' + CAST(@remainingCount AS VARCHAR) + ' component(s) with standby flags!';
    PRINT '';
    PRINT '=======================================================';
    PRINT '❌ FIX INCOMPLETE - MANUAL REVIEW REQUIRED';
    PRINT '=======================================================';
END
PRINT '';

GO
