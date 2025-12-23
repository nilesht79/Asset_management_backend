-- =====================================================
-- RESET OPERATIONAL DATA SCRIPT
-- Deletes: Users, Assets, Tickets, Master Data
-- Preserves: Permissions, OAuth, Roles, System Config
-- Seeds: One superadmin user
-- =====================================================

USE asset_management;
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
PRINT '=============================================='
PRINT 'STARTING DATA RESET...'
PRINT '=============================================='
PRINT ''

-- =====================================================
-- STEP 1: DISABLE ALL FOREIGN KEY CONSTRAINTS
-- =====================================================
PRINT '>> Step 1: Disabling foreign key constraints...'

DECLARE @sql NVARCHAR(MAX) = '';
SELECT @sql = @sql + 'ALTER TABLE [' + OBJECT_SCHEMA_NAME(parent_object_id) + '].[' + OBJECT_NAME(parent_object_id) + '] NOCHECK CONSTRAINT [' + name + '];' + CHAR(13)
FROM sys.foreign_keys;
EXEC sp_executesql @sql;

PRINT '   Foreign keys disabled.'
PRINT ''

-- =====================================================
-- STEP 2: DELETE TICKET-RELATED DATA
-- =====================================================
PRINT '>> Step 2: Deleting ticket-related data...'

DELETE FROM ESCALATION_NOTIFICATIONS_LOG;
PRINT '   - ESCALATION_NOTIFICATIONS_LOG: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_SLA_PAUSE_LOG;
PRINT '   - TICKET_SLA_PAUSE_LOG: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_SLA_TRACKING;
PRINT '   - TICKET_SLA_TRACKING: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_REOPEN_HISTORY;
PRINT '   - TICKET_REOPEN_HISTORY: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_CLOSE_REQUESTS;
PRINT '   - TICKET_CLOSE_REQUESTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_COMMENTS;
PRINT '   - TICKET_COMMENTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_ATTACHMENTS;
PRINT '   - TICKET_ATTACHMENTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_SOFTWARE;
PRINT '   - TICKET_SOFTWARE: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKET_ASSETS;
PRINT '   - TICKET_ASSETS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM SERVICE_REPORT_PARTS;
PRINT '   - SERVICE_REPORT_PARTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM SERVICE_REPORTS;
PRINT '   - SERVICE_REPORTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM GUEST_TICKETS;
PRINT '   - GUEST_TICKETS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM TICKETS;
PRINT '   - TICKETS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

PRINT ''

-- =====================================================
-- STEP 3: DELETE REQUISITION-RELATED DATA
-- =====================================================
PRINT '>> Step 3: Deleting requisition-related data...'

DELETE FROM REQUISITION_APPROVAL_HISTORY;
PRINT '   - REQUISITION_APPROVAL_HISTORY: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM ASSET_DELIVERY_TICKETS;
PRINT '   - ASSET_DELIVERY_TICKETS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM ASSET_REQUISITIONS;
PRINT '   - ASSET_REQUISITIONS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

PRINT ''

-- =====================================================
-- STEP 4: DELETE ASSET-RELATED DATA
-- =====================================================
PRINT '>> Step 4: Deleting asset-related data...'

DELETE FROM RECONCILIATION_DISCREPANCIES;
PRINT '   - RECONCILIATION_DISCREPANCIES: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM RECONCILIATION_RECORDS;
PRINT '   - RECONCILIATION_RECORDS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM RECONCILIATION_PROCESSES;
PRINT '   - RECONCILIATION_PROCESSES: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM GATE_PASS_ASSETS;
PRINT '   - GATE_PASS_ASSETS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM GATE_PASSES;
PRINT '   - GATE_PASSES: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM STANDBY_ASSIGNMENTS;
PRINT '   - STANDBY_ASSIGNMENTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM ASSET_FAULT_FLAGS;
PRINT '   - ASSET_FAULT_FLAGS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM ASSET_REPAIR_HISTORY;
PRINT '   - ASSET_REPAIR_HISTORY: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM ASSET_MOVEMENTS;
PRINT '   - ASSET_MOVEMENTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM asset_software_installations;
PRINT '   - asset_software_installations: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM SOFTWARE_LICENSE_KEYS;
PRINT '   - SOFTWARE_LICENSE_KEYS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM software_licenses;
PRINT '   - software_licenses: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM consumable_transactions;
PRINT '   - consumable_transactions: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM consumable_requests;
PRINT '   - consumable_requests: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM consumable_inventory;
PRINT '   - consumable_inventory: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM consumable_compatibility;
PRINT '   - consumable_compatibility: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM consumables;
PRINT '   - consumables: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM assets;
PRINT '   - assets: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

PRINT ''

-- =====================================================
-- STEP 5: DELETE USER-RELATED DATA
-- =====================================================
PRINT '>> Step 5: Deleting user-related data...'

DELETE FROM USER_NOTIFICATIONS;
PRINT '   - USER_NOTIFICATIONS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM user_activity_logs;
PRINT '   - user_activity_logs: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM USER_CUSTOM_PERMISSIONS;
PRINT '   - USER_CUSTOM_PERMISSIONS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM PASSWORD_RESET_TOKENS;
PRINT '   - PASSWORD_RESET_TOKENS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM oauth_access_tokens;
PRINT '   - oauth_access_tokens: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM oauth_refresh_tokens;
PRINT '   - oauth_refresh_tokens: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM oauth_authorization_codes;
PRINT '   - oauth_authorization_codes: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM USER_MASTER;
PRINT '   - USER_MASTER: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

PRINT ''

-- =====================================================
-- STEP 6: DELETE MASTER DATA
-- =====================================================
PRINT '>> Step 6: Deleting master data...'

DELETE FROM component_field_options;
PRINT '   - component_field_options: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM component_field_templates;
PRINT '   - component_field_templates: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM products;
PRINT '   - products: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM product_series;
PRINT '   - product_series: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM product_types;
PRINT '   - product_types: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM FAULT_TYPES;
PRINT '   - FAULT_TYPES: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM consumable_categories;
PRINT '   - consumable_categories: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM oems;
PRINT '   - oems: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM vendors;
PRINT '   - vendors: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM clients;
PRINT '   - clients: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM categories;
PRINT '   - categories: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM BOARD_DEPARTMENTS;
PRINT '   - BOARD_DEPARTMENTS: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM locations;
PRINT '   - locations: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM location_types;
PRINT '   - location_types: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM DEPARTMENT_MASTER;
PRINT '   - DEPARTMENT_MASTER: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM BOARD_MASTER;
PRINT '   - BOARD_MASTER: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM ORG_MASTER;
PRINT '   - ORG_MASTER: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

PRINT ''

-- =====================================================
-- STEP 7: DELETE LOGS/HISTORY DATA
-- =====================================================
PRINT '>> Step 7: Deleting logs and history...'

DELETE FROM BACKUP_HISTORY;
PRINT '   - BACKUP_HISTORY: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM PERMISSION_AUDIT_LOG;
PRINT '   - PERMISSION_AUDIT_LOG: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

DELETE FROM PERMISSION_CACHE;
PRINT '   - PERMISSION_CACHE: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' rows deleted'

PRINT ''

-- =====================================================
-- STEP 8: RE-ENABLE ALL FOREIGN KEY CONSTRAINTS
-- =====================================================
PRINT '>> Step 8: Re-enabling foreign key constraints...'

SET @sql = '';
SELECT @sql = @sql + 'ALTER TABLE [' + OBJECT_SCHEMA_NAME(parent_object_id) + '].[' + OBJECT_NAME(parent_object_id) + '] WITH CHECK CHECK CONSTRAINT [' + name + '];' + CHAR(13)
FROM sys.foreign_keys;
EXEC sp_executesql @sql;

PRINT '   Foreign keys re-enabled.'
PRINT ''

-- =====================================================
-- STEP 9: SEED SUPERADMIN USER
-- =====================================================
PRINT '>> Step 9: Creating superadmin user...'

-- Password: Admin@123 (bcrypt hash with 10 rounds)
-- You should change this password after first login!
DECLARE @superadmin_id UNIQUEIDENTIFIER = NEWID();

INSERT INTO USER_MASTER (
    user_id,
    email,
    password_hash,
    first_name,
    last_name,
    employee_id,
    role,
    department_id,
    is_active,
    registration_type,
    email_verified,
    failed_login_attempts,
    created_at,
    updated_at,
    user_status,
    has_custom_permissions,
    is_vip,
    location_id,
    allow_multi_assets,
    must_change_password
) VALUES (
    @superadmin_id,
    'admin@company.com',
    '$2a$10$zFeaf2fGpe8ltFaBOjv9auo4a1C6QBG0wC6aSyUQ//GTk670YGi1.', -- Admin@123
    'System',
    'Administrator',
    'ADMIN001',
    'superadmin',
    NULL,
    1,
    'manual',
    1,
    0,
    GETDATE(),
    GETDATE(),
    'active',
    0,
    0,
    NULL,
    0,
    1  -- Must change password on first login
);

PRINT '   Superadmin created:'
PRINT '   - Email: admin@company.com'
PRINT '   - Password: Admin@123'
PRINT '   - Role: superadmin'
PRINT '   - Must change password: YES'
PRINT ''

-- =====================================================
-- STEP 10: SUMMARY
-- =====================================================
PRINT '=============================================='
PRINT 'DATA RESET COMPLETE!'
PRINT '=============================================='
PRINT ''
PRINT 'PRESERVED DATA:'
PRINT '  - PERMISSIONS (74 rows)'
PRINT '  - PERMISSION_CATEGORIES (10 rows)'
PRINT '  - ROLE_PERMISSIONS (265 rows)'
PRINT '  - ROLE_TEMPLATES (8 rows)'
PRINT '  - oauth_clients (3 rows)'
PRINT '  - system_config (6 rows)'
PRINT '  - EMAIL_CONFIGURATION (1 row)'
PRINT '  - SLA_RULES (6 rows)'
PRINT '  - ESCALATION_RULES (6 rows)'
PRINT '  - BUSINESS_HOURS_* tables'
PRINT '  - HOLIDAY_* tables'
PRINT '  - TICKET_REOPEN_CONFIG (1 row)'
PRINT ''
PRINT 'SEEDED DATA:'
PRINT '  - 1 Superadmin user (admin@company.com / Admin@123)'
PRINT ''
PRINT 'IMPORTANT: Change the superadmin password after first login!'
PRINT '=============================================='
GO
