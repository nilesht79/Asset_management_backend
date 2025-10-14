-- Migration: Add building and floor fields to locations table
-- Date: 2025-10-14
-- Description: Add building and floor columns to support detailed location tracking

USE asset_management;
GO

-- Add building column
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'locations' AND COLUMN_NAME = 'building'
)
BEGIN
    ALTER TABLE locations
    ADD building VARCHAR(100) NULL;
    PRINT 'Added building column to locations table';
END
ELSE
BEGIN
    PRINT 'building column already exists in locations table';
END
GO

-- Add floor column
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'locations' AND COLUMN_NAME = 'floor'
)
BEGIN
    ALTER TABLE locations
    ADD floor VARCHAR(50) NULL;
    PRINT 'Added floor column to locations table';
END
ELSE
BEGIN
    PRINT 'floor column already exists in locations table';
END
GO

PRINT 'Migration 004 completed successfully';
GO
