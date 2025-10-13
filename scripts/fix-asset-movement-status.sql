-- =================================================================
-- Fix Asset Movement Status
-- =================================================================
-- Purpose: Update existing ASSET_MOVEMENTS records to have correct
--          status based on whether asset is assigned or not
-- =================================================================

PRINT '========================================';
PRINT 'Fixing Asset Movement Status Records';
PRINT '========================================';
PRINT '';

-- Update movements where asset is assigned but status shows 'available'
UPDATE am
SET
    am.status = 'assigned'
FROM
    dbo.ASSET_MOVEMENTS am
WHERE
    am.assigned_to IS NOT NULL
    AND am.status = 'available';

DECLARE @updatedCount INT = @@ROWCOUNT;
PRINT '✓ Updated ' + CAST(@updatedCount AS VARCHAR) + ' movement records from ''available'' to ''assigned''';

-- Update movements where asset is not assigned but status shows 'assigned'
UPDATE am
SET
    am.status = 'available'
FROM
    dbo.ASSET_MOVEMENTS am
WHERE
    am.assigned_to IS NULL
    AND am.status = 'assigned'
    AND am.movement_type IN ('returned', 'unassigned', 'available');

SET @updatedCount = @@ROWCOUNT;
PRINT '✓ Updated ' + CAST(@updatedCount AS VARCHAR) + ' movement records from ''assigned'' to ''available''';

PRINT '';
PRINT '✓ Asset movement status correction completed';
GO
