-- Migration: Add engineer assignment columns to ASSET_REQUISITIONS table
-- Date: 2025-10-21
-- Description: Add columns to track assigned engineer for asset installation/delivery

USE asset_management;
GO

-- Add engineer assignment columns to ASSET_REQUISITIONS
ALTER TABLE ASSET_REQUISITIONS
ADD
  assigned_engineer_id UNIQUEIDENTIFIER NULL,
  assigned_engineer_name NVARCHAR(200) NULL,
  installation_scheduled_date DATETIME NULL;
GO

PRINT 'Successfully added engineer assignment columns to ASSET_REQUISITIONS table';
GO
