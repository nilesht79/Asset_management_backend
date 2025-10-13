-- =================================================================
-- Fix Asset Status in ASSETS Table
-- =================================================================
-- Purpose: Update assets table to have correct status based on
--          whether they are assigned or not
-- =================================================================

PRINT '========================================';
PRINT 'Fixing Asset Status in ASSETS Table';
PRINT '========================================';
PRINT '';

-- Update assets that are assigned but have status 'available'
UPDATE a
SET
    a.status = 'assigned'
FROM
    dbo.ASSETS a
WHERE
    a.assigned_to IS NOT NULL
    AND a.status = 'available'
    AND a.is_active = 1;

DECLARE @updatedCount INT = @@ROWCOUNT;
PRINT '✓ Updated ' + CAST(@updatedCount AS VARCHAR) + ' assets from ''available'' to ''assigned''';

-- Update assets that are NOT assigned but have status 'assigned'
UPDATE a
SET
    a.status = 'available'
FROM
    dbo.ASSETS a
WHERE
    a.assigned_to IS NULL
    AND a.status = 'assigned'
    AND a.is_active = 1;

SET @updatedCount = @@ROWCOUNT;
PRINT '✓ Updated ' + CAST(@updatedCount AS VARCHAR) + ' assets from ''assigned'' to ''available''';

PRINT '';
PRINT '✓ Asset status correction completed';
GO
