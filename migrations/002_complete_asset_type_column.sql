USE asset_management;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- Update existing records
UPDATE assets SET asset_type = 'standalone';
GO

-- Make column NOT NULL
ALTER TABLE assets ALTER COLUMN asset_type VARCHAR(20) NOT NULL;
GO

-- Add default constraint
ALTER TABLE assets ADD CONSTRAINT DF_assets_asset_type DEFAULT 'standalone' FOR asset_type;
GO

-- Add check constraint
ALTER TABLE assets ADD CONSTRAINT CHK_assets_asset_type CHECK (asset_type IN ('standalone', 'parent', 'component'));
GO

PRINT 'Successfully configured asset_type column';
GO
