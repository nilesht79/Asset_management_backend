-- Add location_id column to USER_MASTER table
-- This allows users to be associated with a specific location

-- Check if column already exists before adding
IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'USER_MASTER'
    AND COLUMN_NAME = 'location_id'
)
BEGIN
    ALTER TABLE USER_MASTER
    ADD location_id UNIQUEIDENTIFIER NULL;

    PRINT 'Column location_id added to USER_MASTER table';
END
ELSE
BEGIN
    PRINT 'Column location_id already exists in USER_MASTER table';
END
GO

-- Add foreign key constraint to locations table
IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_USER_MASTER_locations'
)
BEGIN
    ALTER TABLE USER_MASTER
    ADD CONSTRAINT FK_USER_MASTER_locations
    FOREIGN KEY (location_id) REFERENCES locations(id);

    PRINT 'Foreign key constraint FK_USER_MASTER_locations added';
END
ELSE
BEGIN
    PRINT 'Foreign key constraint FK_USER_MASTER_locations already exists';
END
GO

-- Create index on location_id for better query performance
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_USER_MASTER_location_id'
    AND object_id = OBJECT_ID('USER_MASTER')
)
BEGIN
    CREATE INDEX IX_USER_MASTER_location_id
    ON USER_MASTER(location_id);

    PRINT 'Index IX_USER_MASTER_location_id created';
END
ELSE
BEGIN
    PRINT 'Index IX_USER_MASTER_location_id already exists';
END
GO

PRINT 'Migration completed successfully!';
