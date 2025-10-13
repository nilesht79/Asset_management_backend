-- Migration: Remove location_id from assets table
-- Assets will now inherit location from their assigned user
-- Date: 2025-10-13

USE asset_management;
GO

-- Step 1: Check if foreign key constraint exists and drop it
IF EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_assets_location_id'
    AND parent_object_id = OBJECT_ID('assets')
)
BEGIN
    ALTER TABLE assets DROP CONSTRAINT FK_assets_location_id;
    PRINT 'Foreign key constraint FK_assets_location_id dropped successfully';
END
ELSE
BEGIN
    PRINT 'Foreign key constraint FK_assets_location_id does not exist';
END
GO

-- Step 2: Check if index exists and drop it
IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_assets_location_id'
    AND object_id = OBJECT_ID('assets')
)
BEGIN
    DROP INDEX IX_assets_location_id ON assets;
    PRINT 'Index IX_assets_location_id dropped successfully';
END
ELSE
BEGIN
    PRINT 'Index IX_assets_location_id does not exist';
END
GO

-- Step 3: Drop the location_id column
IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets'
    AND COLUMN_NAME = 'location_id'
)
BEGIN
    ALTER TABLE assets DROP COLUMN location_id;
    PRINT 'Column location_id dropped from assets table successfully';
    PRINT 'Assets will now inherit location from their assigned user';
END
ELSE
BEGIN
    PRINT 'Column location_id does not exist in assets table';
END
GO

-- Verification: Show current assets table structure
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'assets'
ORDER BY ORDINAL_POSITION;
GO
