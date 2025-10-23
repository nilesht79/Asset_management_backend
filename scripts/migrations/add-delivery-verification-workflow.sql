-- Migration: Add Delivery Verification Workflow
-- Description: Adds signature verification and functionality confirmation workflow
-- Date: 2025-10-22

USE asset_management;
GO

-- Add new columns to ASSET_DELIVERY_TICKETS table
ALTER TABLE ASSET_DELIVERY_TICKETS
ADD
    -- Signed Form Upload (offline)
    signed_form_upload_path VARCHAR(500) NULL,
    signed_form_uploaded_by UNIQUEIDENTIFIER NULL,
    signed_form_uploaded_at DATETIME NULL,

    -- Coordinator Verification
    coordinator_verified BIT DEFAULT 0,
    coordinator_verified_by UNIQUEIDENTIFIER NULL,
    coordinator_verified_at DATETIME NULL,
    coordinator_verification_notes TEXT NULL,

    -- Functionality Confirmation
    functionality_confirmed BIT DEFAULT 0,
    functionality_confirmed_at DATETIME NULL,
    functionality_notes TEXT NULL,

    -- Foreign keys
    CONSTRAINT FK_DeliveryTickets_SignedFormUploadedBy FOREIGN KEY (signed_form_uploaded_by) REFERENCES USER_MASTER(user_id),
    CONSTRAINT FK_DeliveryTickets_CoordinatorVerifiedBy FOREIGN KEY (coordinator_verified_by) REFERENCES USER_MASTER(user_id);
GO

-- Add index for verification queries
CREATE INDEX idx_delivery_tickets_verification
ON ASSET_DELIVERY_TICKETS(coordinator_verified, status);
GO

CREATE INDEX idx_delivery_tickets_functionality
ON ASSET_DELIVERY_TICKETS(functionality_confirmed, status);
GO

PRINT 'Migration completed: Delivery verification workflow columns added successfully';
GO
