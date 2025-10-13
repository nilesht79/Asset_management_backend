-- =====================================================
-- PERMISSION SYSTEM SEED DATA
-- =====================================================
-- This script populates the permission system with initial data
-- Execute AFTER running 001_permission_system.sql

USE [asset_management]; -- Update with your database name
GO

-- =====================================================
-- 1. INSERT PERMISSION CATEGORIES
-- =====================================================
PRINT 'Seeding Permission Categories...';

INSERT INTO PERMISSION_CATEGORIES (category_key, category_name, description, display_order, is_active)
VALUES
    ('user_management', 'User Management', 'User and role management permissions', 1, 1),
    ('asset_management', 'Asset Management', 'Asset lifecycle and inventory permissions', 2, 1),
    ('master_data', 'Master Data', 'Master data management permissions', 3, 1),
    ('department_management', 'Department Management', 'Department structure and management permissions', 4, 1),
    ('ticket_management', 'Ticket Management', 'Ticket and support request permissions', 5, 1),
    ('reports', 'Reports & Analytics', 'Reporting and analytics permissions', 6, 1),
    ('system_administration', 'System Administration', 'System-level administrative permissions', 7, 1),
    ('permission_control', 'Permission Control', 'Permission management and control permissions', 8, 1);

PRINT 'Inserted ' + CAST(@@ROWCOUNT AS VARCHAR) + ' permission categories';
GO

-- =====================================================
-- 2. INSERT PERMISSIONS
-- =====================================================
PRINT 'Seeding Permissions...';

DECLARE @user_mgmt_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'user_management');
DECLARE @asset_mgmt_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'asset_management');
DECLARE @master_data_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'master_data');
DECLARE @dept_mgmt_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'department_management');
DECLARE @ticket_mgmt_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'ticket_management');
DECLARE @reports_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'reports');
DECLARE @system_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'system_administration');
DECLARE @perm_control_cat UNIQUEIDENTIFIER = (SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_key = 'permission_control');

-- User Management Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('users.create', 'Create Users', 'Create new user accounts', @user_mgmt_cat, 'users', 'create', 1, 1),
    ('users.read', 'View Users', 'View user information and profiles', @user_mgmt_cat, 'users', 'read', 1, 2),
    ('users.update', 'Update Users', 'Modify user information and settings', @user_mgmt_cat, 'users', 'update', 1, 3),
    ('users.delete', 'Delete Users', 'Delete or deactivate user accounts', @user_mgmt_cat, 'users', 'delete', 1, 4),
    ('users.assign_roles', 'Assign User Roles', 'Assign or change user roles', @user_mgmt_cat, 'users', 'assign_roles', 1, 5),
    ('users.reset_password', 'Reset User Passwords', 'Reset user passwords', @user_mgmt_cat, 'users', 'reset_password', 1, 6);

-- Asset Management Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('assets.create', 'Create Assets', 'Add new assets to inventory', @asset_mgmt_cat, 'assets', 'create', 1, 1),
    ('assets.read', 'View Assets', 'View asset information', @asset_mgmt_cat, 'assets', 'read', 1, 2),
    ('assets.update', 'Update Assets', 'Modify asset information', @asset_mgmt_cat, 'assets', 'update', 1, 3),
    ('assets.delete', 'Delete Assets', 'Delete or deactivate assets', @asset_mgmt_cat, 'assets', 'delete', 1, 4),
    ('assets.assign', 'Assign Assets', 'Assign assets to users or departments', @asset_mgmt_cat, 'assets', 'assign', 1, 5),
    ('assets.transfer', 'Transfer Assets', 'Transfer assets between locations or users', @asset_mgmt_cat, 'assets', 'transfer', 1, 6),
    ('assets.maintenance', 'Manage Asset Maintenance', 'Record and manage asset maintenance', @asset_mgmt_cat, 'assets', 'maintenance', 1, 7),
    ('assets.retire', 'Retire Assets', 'Retire or dispose of assets', @asset_mgmt_cat, 'assets', 'retire', 1, 8);

-- Master Data Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('masters.read', 'View Master Data', 'View all master data', @master_data_cat, 'masters', 'read', 1, 1),
    ('masters.create', 'Create Master Data', 'Create new master data entries', @master_data_cat, 'masters', 'create', 1, 2),
    ('masters.update', 'Update Master Data', 'Modify master data entries', @master_data_cat, 'masters', 'update', 1, 3),
    ('masters.delete', 'Delete Master Data', 'Delete master data entries', @master_data_cat, 'masters', 'delete', 1, 4),
    ('masters.write', 'Write Master Data', 'Full write access to master data', @master_data_cat, 'masters', 'write', 1, 5),
    ('masters.oem.manage', 'Manage OEMs', 'Full access to OEM master data', @master_data_cat, 'masters', 'manage', 1, 6),
    ('masters.categories.manage', 'Manage Categories', 'Full access to category master data', @master_data_cat, 'masters', 'manage', 1, 7),
    ('masters.subcategories.manage', 'Manage Subcategories', 'Full access to subcategory master data', @master_data_cat, 'masters', 'manage', 1, 8),
    ('masters.products.manage', 'Manage Products', 'Full access to product master data', @master_data_cat, 'masters', 'manage', 1, 9),
    ('masters.locations.manage', 'Manage Locations', 'Full access to location master data', @master_data_cat, 'masters', 'manage', 1, 10),
    ('masters.location-types.manage', 'Manage Location Types', 'Full access to location type master data', @master_data_cat, 'masters', 'manage', 1, 11),
    ('masters.clients.manage', 'Manage Clients', 'Full access to client master data', @master_data_cat, 'masters', 'manage', 1, 12),
    ('masters.product-types.manage', 'Manage Product Types', 'Full access to product type master data', @master_data_cat, 'masters', 'manage', 1, 13),
    ('masters.product-series.manage', 'Manage Product Series', 'Full access to product series master data', @master_data_cat, 'masters', 'manage', 1, 14);

-- Department Management Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('departments.create', 'Create Departments', 'Create new departments', @dept_mgmt_cat, 'departments', 'create', 1, 1),
    ('departments.read', 'View Departments', 'View department information', @dept_mgmt_cat, 'departments', 'read', 1, 2),
    ('departments.update', 'Update Departments', 'Modify department information', @dept_mgmt_cat, 'departments', 'update', 1, 3),
    ('departments.delete', 'Delete Departments', 'Delete or deactivate departments', @dept_mgmt_cat, 'departments', 'delete', 1, 4),
    ('departments.manage_hierarchy', 'Manage Department Hierarchy', 'Manage department structure and relationships', @dept_mgmt_cat, 'departments', 'manage_hierarchy', 1, 5);

-- Ticket Management Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('tickets.create', 'Create Tickets', 'Create new support tickets', @ticket_mgmt_cat, 'tickets', 'create', 1, 1),
    ('tickets.read', 'View Tickets', 'View ticket information', @ticket_mgmt_cat, 'tickets', 'read', 1, 2),
    ('tickets.update', 'Update Tickets', 'Modify ticket information and status', @ticket_mgmt_cat, 'tickets', 'update', 1, 3),
    ('tickets.delete', 'Delete Tickets', 'Delete tickets', @ticket_mgmt_cat, 'tickets', 'delete', 1, 4),
    ('tickets.assign', 'Assign Tickets', 'Assign tickets to engineers', @ticket_mgmt_cat, 'tickets', 'assign', 1, 5),
    ('tickets.close', 'Close Tickets', 'Close and resolve tickets', @ticket_mgmt_cat, 'tickets', 'close', 1, 6);

-- Reports & Analytics Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('reports.view', 'View Reports', 'View system reports', @reports_cat, 'reports', 'view', 1, 1),
    ('reports.export', 'Export Reports', 'Export reports to files', @reports_cat, 'reports', 'export', 1, 2),
    ('reports.dashboard', 'Access Dashboard', 'Access dashboard and analytics', @reports_cat, 'reports', 'dashboard', 1, 3),
    ('reports.analytics', 'Advanced Analytics', 'Access advanced analytics features', @reports_cat, 'reports', 'analytics', 1, 4);

-- System Administration Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('system.create', 'Create System Resources', 'Create system-level resources', @system_cat, 'system', 'create', 1, 1),
    ('system.read', 'View System Resources', 'View system configuration and resources', @system_cat, 'system', 'read', 1, 2),
    ('system.update', 'Update System Resources', 'Modify system configuration', @system_cat, 'system', 'update', 1, 3),
    ('system.settings', 'Manage System Settings', 'Configure system settings', @system_cat, 'system', 'settings', 1, 4),
    ('system.logs', 'View System Logs', 'Access system logs and audit trails', @system_cat, 'system', 'logs', 1, 5),
    ('system.backup', 'Manage Backups', 'Create and manage system backups', @system_cat, 'system', 'backup', 1, 6),
    ('system.maintenance', 'System Maintenance', 'Perform system maintenance tasks', @system_cat, 'system', 'maintenance', 1, 7);

-- Permission Control Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('permission-control.read', 'View Permission Control', 'View permission configurations', @perm_control_cat, 'permission-control', 'read', 1, 1),
    ('permission-control.create', 'Create Permissions', 'Create new custom permissions', @perm_control_cat, 'permission-control', 'create', 1, 2),
    ('permission-control.update', 'Update Permissions', 'Modify role and user permissions', @perm_control_cat, 'permission-control', 'update', 1, 3),
    ('permission-control.delete', 'Delete Permissions', 'Delete custom permissions', @perm_control_cat, 'permission-control', 'delete', 1, 4);

-- Statistics Permissions
INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, display_order)
VALUES
    ('statistics.read', 'View Statistics', 'View system statistics and metrics', @reports_cat, 'statistics', 'read', 1, 5);

PRINT 'Inserted ' + CAST(@@ROWCOUNT AS VARCHAR) + ' permissions';
GO

-- =====================================================
-- 3. INSERT ROLE TEMPLATES
-- =====================================================
PRINT 'Seeding Role Templates...';

INSERT INTO ROLE_TEMPLATES (role_name, display_name, description, hierarchy_level, is_system_role, is_active)
VALUES
    ('superadmin', 'Super Administrator', 'Complete system access and control', 100, 1, 1),
    ('admin', 'Administrator', 'Administrative access with user management', 90, 1, 1),
    ('department_head', 'Department Head', 'Department-level management and approvals', 70, 1, 1),
    ('coordinator', 'Coordinator', 'Asset coordination and ticket management', 60, 1, 1),
    ('department_coordinator', 'Department Coordinator', 'Department-scoped coordination', 50, 1, 1),
    ('engineer', 'Engineer', 'Technical support and maintenance', 30, 1, 1),
    ('employee', 'Employee', 'Basic access for asset viewing and requests', 10, 1, 1);

PRINT 'Inserted ' + CAST(@@ROWCOUNT AS VARCHAR) + ' role templates';
GO

-- =====================================================
-- 4. ASSIGN PERMISSIONS TO ROLES
-- =====================================================
PRINT 'Assigning permissions to role templates...';

-- Get role IDs
DECLARE @superadmin_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'superadmin');
DECLARE @admin_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'admin');
DECLARE @dept_head_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'department_head');
DECLARE @coordinator_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'coordinator');
DECLARE @dept_coordinator_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'department_coordinator');
DECLARE @engineer_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'engineer');
DECLARE @employee_role UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'employee');

-- SUPERADMIN: All permissions
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @superadmin_role, permission_id
FROM PERMISSIONS;

PRINT 'Assigned all permissions to superadmin';

-- ADMIN: All except user deletion, system backup, permission deletion
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @admin_role, permission_id
FROM PERMISSIONS
WHERE permission_key NOT IN ('users.delete', 'system.backup', 'permission-control.delete');

PRINT 'Assigned permissions to admin';

-- DEPARTMENT HEAD: User read/update, asset read/assign/transfer, department read/update, ticket management, reports
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @dept_head_role, permission_id
FROM PERMISSIONS
WHERE permission_key IN (
    'users.read', 'users.update',
    'assets.read', 'assets.assign', 'assets.transfer',
    'masters.read',
    'departments.read', 'departments.update',
    'tickets.create', 'tickets.read', 'tickets.update', 'tickets.assign',
    'reports.view', 'reports.dashboard'
);

PRINT 'Assigned permissions to department_head';

-- COORDINATOR: Asset CRUD, assignment, maintenance, ticket management
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @coordinator_role, permission_id
FROM PERMISSIONS
WHERE permission_key IN (
    'users.read',
    'assets.create', 'assets.read', 'assets.update', 'assets.assign', 'assets.maintenance',
    'masters.read',
    'tickets.create', 'tickets.read', 'tickets.update',
    'reports.view'
);

PRINT 'Assigned permissions to coordinator';

-- DEPARTMENT COORDINATOR: Limited asset and ticket access
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @dept_coordinator_role, permission_id
FROM PERMISSIONS
WHERE permission_key IN (
    'users.read',
    'assets.read', 'assets.assign', 'assets.maintenance',
    'masters.read',
    'tickets.create', 'tickets.read', 'tickets.update',
    'reports.view'
);

PRINT 'Assigned permissions to department_coordinator';

-- ENGINEER: Ticket handling, asset viewing and maintenance
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @engineer_role, permission_id
FROM PERMISSIONS
WHERE permission_key IN (
    'tickets.read', 'tickets.update',
    'assets.read', 'assets.maintenance',
    'masters.read',
    'reports.view'
);

PRINT 'Assigned permissions to engineer';

-- EMPLOYEE: Basic read access, ticket creation
INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
SELECT @employee_role, permission_id
FROM PERMISSIONS
WHERE permission_key IN (
    'assets.read',
    'masters.read',
    'tickets.create', 'tickets.read',
    'reports.view'
);

PRINT 'Assigned permissions to employee';
GO

PRINT '';
PRINT '=====================================================';
PRINT 'PERMISSION SYSTEM SEED DATA LOADED SUCCESSFULLY';
PRINT '=====================================================';
PRINT '';
PRINT 'Summary:';
PRINT '- Permission Categories: 8';
PRINT '- Permissions: 50+';
PRINT '- Role Templates: 7';
PRINT '';
PRINT 'Next steps:';
PRINT '1. Restart your Node.js application';
PRINT '2. Test the permission system';
PRINT '3. Access SuperAdmin panel to customize permissions';
PRINT '';
GO
