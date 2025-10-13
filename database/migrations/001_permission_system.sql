-- =====================================================
-- COMPLETE PERMISSION SYSTEM DATABASE SCHEMA
-- =====================================================
-- This migration creates the complete permission management system
-- Execute this script in SQL Server Management Studio or via sqlcmd

USE [asset_management]; -- Update with your database name
GO

-- =====================================================
-- 1. PERMISSION CATEGORIES TABLE
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PERMISSION_CATEGORIES')
BEGIN
    CREATE TABLE PERMISSION_CATEGORIES (
        category_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        category_key VARCHAR(100) NOT NULL UNIQUE,
        category_name NVARCHAR(200) NOT NULL,
        description NVARCHAR(500),
        display_order INT DEFAULT 0,
        is_active BIT DEFAULT 1,
        created_at DATETIME2 DEFAULT GETUTCDATE(),
        updated_at DATETIME2 DEFAULT GETUTCDATE(),
        created_by UNIQUEIDENTIFIER,
        updated_by UNIQUEIDENTIFIER
    );

    CREATE INDEX IDX_PERMISSION_CATEGORIES_KEY ON PERMISSION_CATEGORIES(category_key);
    CREATE INDEX IDX_PERMISSION_CATEGORIES_ACTIVE ON PERMISSION_CATEGORIES(is_active);

    PRINT 'Created table: PERMISSION_CATEGORIES';
END
GO

-- =====================================================
-- 2. PERMISSIONS TABLE (Master Permission List)
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PERMISSIONS')
BEGIN
    CREATE TABLE PERMISSIONS (
        permission_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        permission_key VARCHAR(200) NOT NULL UNIQUE,
        permission_name NVARCHAR(200) NOT NULL,
        description NVARCHAR(500),
        category_id UNIQUEIDENTIFIER,
        resource_type VARCHAR(100), -- e.g., 'users', 'assets', 'masters'
        action_type VARCHAR(50), -- e.g., 'create', 'read', 'update', 'delete'
        is_system BIT DEFAULT 0, -- System permissions cannot be deleted
        is_active BIT DEFAULT 1,
        display_order INT DEFAULT 0,
        created_at DATETIME2 DEFAULT GETUTCDATE(),
        updated_at DATETIME2 DEFAULT GETUTCDATE(),
        created_by UNIQUEIDENTIFIER,
        updated_by UNIQUEIDENTIFIER,
        CONSTRAINT FK_PERMISSIONS_CATEGORY FOREIGN KEY (category_id)
            REFERENCES PERMISSION_CATEGORIES(category_id) ON DELETE SET NULL
    );

    CREATE INDEX IDX_PERMISSIONS_KEY ON PERMISSIONS(permission_key);
    CREATE INDEX IDX_PERMISSIONS_CATEGORY ON PERMISSIONS(category_id);
    CREATE INDEX IDX_PERMISSIONS_RESOURCE ON PERMISSIONS(resource_type, action_type);
    CREATE INDEX IDX_PERMISSIONS_ACTIVE ON PERMISSIONS(is_active);

    PRINT 'Created table: PERMISSIONS';
END
GO

-- =====================================================
-- 3. ROLE TEMPLATES TABLE (Role Default Permissions)
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ROLE_TEMPLATES')
BEGIN
    CREATE TABLE ROLE_TEMPLATES (
        role_template_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        role_name VARCHAR(50) NOT NULL UNIQUE,
        display_name NVARCHAR(100) NOT NULL,
        description NVARCHAR(500),
        hierarchy_level INT NOT NULL, -- Higher = More privileged
        is_system_role BIT DEFAULT 0, -- System roles have restrictions
        is_active BIT DEFAULT 1,
        created_at DATETIME2 DEFAULT GETUTCDATE(),
        updated_at DATETIME2 DEFAULT GETUTCDATE(),
        created_by UNIQUEIDENTIFIER,
        updated_by UNIQUEIDENTIFIER
    );

    CREATE INDEX IDX_ROLE_TEMPLATES_NAME ON ROLE_TEMPLATES(role_name);
    CREATE INDEX IDX_ROLE_TEMPLATES_HIERARCHY ON ROLE_TEMPLATES(hierarchy_level);
    CREATE INDEX IDX_ROLE_TEMPLATES_ACTIVE ON ROLE_TEMPLATES(is_active);

    PRINT 'Created table: ROLE_TEMPLATES';
END
GO

-- =====================================================
-- 4. ROLE PERMISSIONS TABLE (Many-to-Many)
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ROLE_PERMISSIONS')
BEGIN
    CREATE TABLE ROLE_PERMISSIONS (
        role_permission_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        role_template_id UNIQUEIDENTIFIER NOT NULL,
        permission_id UNIQUEIDENTIFIER NOT NULL,
        granted_at DATETIME2 DEFAULT GETUTCDATE(),
        granted_by UNIQUEIDENTIFIER,
        CONSTRAINT FK_ROLE_PERMISSIONS_ROLE FOREIGN KEY (role_template_id)
            REFERENCES ROLE_TEMPLATES(role_template_id) ON DELETE CASCADE,
        CONSTRAINT FK_ROLE_PERMISSIONS_PERMISSION FOREIGN KEY (permission_id)
            REFERENCES PERMISSIONS(permission_id) ON DELETE CASCADE,
        CONSTRAINT UQ_ROLE_PERMISSION UNIQUE (role_template_id, permission_id)
    );

    CREATE INDEX IDX_ROLE_PERMISSIONS_ROLE ON ROLE_PERMISSIONS(role_template_id);
    CREATE INDEX IDX_ROLE_PERMISSIONS_PERMISSION ON ROLE_PERMISSIONS(permission_id);

    PRINT 'Created table: ROLE_PERMISSIONS';
END
GO

-- =====================================================
-- 5. USER CUSTOM PERMISSIONS TABLE
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'USER_CUSTOM_PERMISSIONS')
BEGIN
    CREATE TABLE USER_CUSTOM_PERMISSIONS (
        user_permission_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        permission_id UNIQUEIDENTIFIER NOT NULL,
        is_granted BIT DEFAULT 1, -- 1 = granted, 0 = revoked (override)
        granted_at DATETIME2 DEFAULT GETUTCDATE(),
        granted_by UNIQUEIDENTIFIER,
        expires_at DATETIME2, -- NULL = no expiration
        reason NVARCHAR(500), -- Why was this permission granted/revoked?
        CONSTRAINT FK_USER_CUSTOM_PERMISSIONS_USER FOREIGN KEY (user_id)
            REFERENCES USER_MASTER(user_id) ON DELETE CASCADE,
        CONSTRAINT FK_USER_CUSTOM_PERMISSIONS_PERMISSION FOREIGN KEY (permission_id)
            REFERENCES PERMISSIONS(permission_id) ON DELETE CASCADE,
        CONSTRAINT UQ_USER_PERMISSION UNIQUE (user_id, permission_id)
    );

    CREATE INDEX IDX_USER_CUSTOM_PERMISSIONS_USER ON USER_CUSTOM_PERMISSIONS(user_id);
    CREATE INDEX IDX_USER_CUSTOM_PERMISSIONS_PERMISSION ON USER_CUSTOM_PERMISSIONS(permission_id);
    CREATE INDEX IDX_USER_CUSTOM_PERMISSIONS_GRANTED ON USER_CUSTOM_PERMISSIONS(is_granted);
    CREATE INDEX IDX_USER_CUSTOM_PERMISSIONS_EXPIRES ON USER_CUSTOM_PERMISSIONS(expires_at);

    PRINT 'Created table: USER_CUSTOM_PERMISSIONS';
END
GO

-- =====================================================
-- 6. PERMISSION AUDIT LOG TABLE
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PERMISSION_AUDIT_LOG')
BEGIN
    CREATE TABLE PERMISSION_AUDIT_LOG (
        audit_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        action_type VARCHAR(50) NOT NULL, -- GRANT, REVOKE, ROLE_UPDATE, etc.
        target_type VARCHAR(50) NOT NULL, -- USER, ROLE, SYSTEM
        target_id UNIQUEIDENTIFIER, -- user_id or role_template_id
        permission_id UNIQUEIDENTIFIER,
        old_value NVARCHAR(MAX), -- JSON of previous state
        new_value NVARCHAR(MAX), -- JSON of new state
        performed_by UNIQUEIDENTIFIER NOT NULL,
        performed_at DATETIME2 DEFAULT GETUTCDATE(),
        ip_address VARCHAR(45),
        user_agent NVARCHAR(500),
        reason NVARCHAR(500),
        CONSTRAINT FK_PERMISSION_AUDIT_PERFORMER FOREIGN KEY (performed_by)
            REFERENCES USER_MASTER(user_id)
    );

    CREATE INDEX IDX_PERMISSION_AUDIT_ACTION ON PERMISSION_AUDIT_LOG(action_type);
    CREATE INDEX IDX_PERMISSION_AUDIT_TARGET ON PERMISSION_AUDIT_LOG(target_type, target_id);
    CREATE INDEX IDX_PERMISSION_AUDIT_PERFORMER ON PERMISSION_AUDIT_LOG(performed_by);
    CREATE INDEX IDX_PERMISSION_AUDIT_DATE ON PERMISSION_AUDIT_LOG(performed_at DESC);

    PRINT 'Created table: PERMISSION_AUDIT_LOG';
END
GO

-- =====================================================
-- 7. PERMISSION CACHE TABLE (Optional - for performance)
-- =====================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PERMISSION_CACHE')
BEGIN
    CREATE TABLE PERMISSION_CACHE (
        cache_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        permissions_json NVARCHAR(MAX) NOT NULL, -- JSON array of permission keys
        cached_at DATETIME2 DEFAULT GETUTCDATE(),
        expires_at DATETIME2 NOT NULL,
        CONSTRAINT FK_PERMISSION_CACHE_USER FOREIGN KEY (user_id)
            REFERENCES USER_MASTER(user_id) ON DELETE CASCADE,
        CONSTRAINT UQ_PERMISSION_CACHE_USER UNIQUE (user_id)
    );

    CREATE INDEX IDX_PERMISSION_CACHE_USER ON PERMISSION_CACHE(user_id);
    CREATE INDEX IDX_PERMISSION_CACHE_EXPIRES ON PERMISSION_CACHE(expires_at);

    PRINT 'Created table: PERMISSION_CACHE';
END
GO

-- =====================================================
-- 8. ADD COLUMNS TO EXISTING USER_MASTER TABLE (if needed)
-- =====================================================
-- Check if permissions column exists, if not add it
IF NOT EXISTS (SELECT * FROM sys.columns
               WHERE object_id = OBJECT_ID('USER_MASTER')
               AND name = 'has_custom_permissions')
BEGIN
    ALTER TABLE USER_MASTER
    ADD has_custom_permissions BIT DEFAULT 0;

    PRINT 'Added column: USER_MASTER.has_custom_permissions';
END
GO

-- Remove old permissions JSON column if it exists (we're using separate table now)
IF EXISTS (SELECT * FROM sys.columns
           WHERE object_id = OBJECT_ID('USER_MASTER')
           AND name = 'permissions')
BEGIN
    ALTER TABLE USER_MASTER
    DROP COLUMN permissions;

    PRINT 'Removed deprecated column: USER_MASTER.permissions';
END
GO

PRINT '';
PRINT '=====================================================';
PRINT 'PERMISSION SYSTEM TABLES CREATED SUCCESSFULLY';
PRINT '=====================================================';
PRINT '';
PRINT 'Next steps:';
PRINT '1. Run 002_permission_seed_data.sql to populate initial data';
PRINT '2. Restart your Node.js application';
PRINT '3. Access SuperAdmin panel at /settings/permission-control';
PRINT '';
GO
