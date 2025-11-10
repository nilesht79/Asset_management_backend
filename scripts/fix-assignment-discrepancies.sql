-- ============================================================================
-- Fix Assignment Discrepancies - Replace User IDs with User Names
-- Description: Updates existing assignment discrepancies that show
--              "User ID: xxx" to show actual user names
-- Date: 2025-11-08
-- ============================================================================

USE asset_management;
GO

DECLARE @UpdateCount INT = 0;

-- Update physical_value for assignment discrepancies
UPDATE d
SET d.physical_value = CONCAT(u.first_name, ' ', u.last_name)
FROM RECONCILIATION_DISCREPANCIES d
LEFT JOIN USER_MASTER u ON
    -- Extract UUID from "User ID: xxx" format
    CAST(SUBSTRING(d.physical_value, CHARINDEX('User ID: ', d.physical_value) + 9, 36) AS UNIQUEIDENTIFIER) = u.user_id
WHERE
    d.field_name = 'assigned_to'
    AND d.physical_value LIKE 'User ID:%'
    AND u.user_id IS NOT NULL;

SET @UpdateCount = @@ROWCOUNT;

PRINT 'Updated ' + CAST(@UpdateCount AS VARCHAR) + ' physical_value records';

-- Update system_value for assignment discrepancies (if any have this issue)
UPDATE d
SET d.system_value = CONCAT(u.first_name, ' ', u.last_name)
FROM RECONCILIATION_DISCREPANCIES d
LEFT JOIN USER_MASTER u ON
    CAST(SUBSTRING(d.system_value, CHARINDEX('User ID: ', d.system_value) + 9, 36) AS UNIQUEIDENTIFIER) = u.user_id
WHERE
    d.field_name = 'assigned_to'
    AND d.system_value LIKE 'User ID:%'
    AND u.user_id IS NOT NULL;

SET @UpdateCount = @@ROWCOUNT;

PRINT 'Updated ' + CAST(@UpdateCount AS VARCHAR) + ' system_value records';

-- Show summary of remaining issues (if any)
SELECT
    COUNT(*) as remaining_issues,
    'Physical Value' as value_type
FROM RECONCILIATION_DISCREPANCIES
WHERE field_name = 'assigned_to' AND physical_value LIKE 'User ID:%'
UNION ALL
SELECT
    COUNT(*) as remaining_issues,
    'System Value' as value_type
FROM RECONCILIATION_DISCREPANCIES
WHERE field_name = 'assigned_to' AND system_value LIKE 'User ID:%';

GO

PRINT 'Assignment discrepancies fixed successfully';
