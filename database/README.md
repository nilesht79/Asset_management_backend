# Permission System Database Setup

## Overview

This directory contains the database schema and seed data for the complete permission management system.

## Files

- `migrations/001_permission_system.sql` - Creates all permission system tables
- `migrations/002_permission_seed_data.sql` - Seeds initial permissions, categories, roles, and mappings

## Database Tables Created

### 1. PERMISSION_CATEGORIES
Organizes permissions into logical categories for better management.

```sql
- category_id (UNIQUEIDENTIFIER, PK)
- category_key (VARCHAR, UNIQUE)
- category_name (NVARCHAR)
- description (NVARCHAR)
- display_order (INT)
- is_active (BIT)
```

### 2. PERMISSIONS
Master list of all available permissions in the system.

```sql
- permission_id (UNIQUEIDENTIFIER, PK)
- permission_key (VARCHAR, UNIQUE) -- e.g., 'users.create'
- permission_name (NVARCHAR) -- e.g., 'Create Users'
- description (NVARCHAR)
- category_id (UNIQUEIDENTIFIER, FK)
- resource_type (VARCHAR) -- e.g., 'users', 'assets'
- action_type (VARCHAR) -- e.g., 'create', 'read', 'update'
- is_system (BIT) -- System permissions cannot be deleted
- is_active (BIT)
```

### 3. ROLE_TEMPLATES
Defines the available roles in the system.

```sql
- role_template_id (UNIQUEIDENTIFIER, PK)
- role_name (VARCHAR, UNIQUE) -- e.g., 'admin', 'coordinator'
- display_name (NVARCHAR) -- e.g., 'Administrator'
- description (NVARCHAR)
- hierarchy_level (INT) -- Higher = more privileged
- is_system_role (BIT) -- System roles have special restrictions
- is_active (BIT)
```

### 4. ROLE_PERMISSIONS
Maps permissions to roles (many-to-many relationship).

```sql
- role_permission_id (UNIQUEIDENTIFIER, PK)
- role_template_id (UNIQUEIDENTIFIER, FK)
- permission_id (UNIQUEIDENTIFIER, FK)
- granted_at (DATETIME2)
- granted_by (UNIQUEIDENTIFIER)
```

### 5. USER_CUSTOM_PERMISSIONS
Stores user-specific permission overrides (grants or revokes).

```sql
- user_permission_id (UNIQUEIDENTIFIER, PK)
- user_id (UNIQUEIDENTIFIER, FK)
- permission_id (UNIQUEIDENTIFIER, FK)
- is_granted (BIT) -- 1 = granted, 0 = revoked
- granted_by (UNIQUEIDENTIFIER)
- granted_at (DATETIME2)
- expires_at (DATETIME2, NULL) -- Optional expiration
- reason (NVARCHAR) -- Audit trail
```

### 6. PERMISSION_AUDIT_LOG
Complete audit trail of all permission changes.

```sql
- audit_id (UNIQUEIDENTIFIER, PK)
- action_type (VARCHAR) -- GRANT, REVOKE, ROLE_UPDATE, etc.
- target_type (VARCHAR) -- USER, ROLE, SYSTEM
- target_id (UNIQUEIDENTIFIER) -- user_id or role_template_id
- permission_id (UNIQUEIDENTIFIER)
- old_value (NVARCHAR(MAX)) -- JSON
- new_value (NVARCHAR(MAX)) -- JSON
- performed_by (UNIQUEIDENTIFIER)
- performed_at (DATETIME2)
- ip_address (VARCHAR)
- reason (NVARCHAR)
```

### 7. PERMISSION_CACHE
Optional performance cache for user permissions.

```sql
- cache_id (UNIQUEIDENTIFIER, PK)
- user_id (UNIQUEIDENTIFIER, FK, UNIQUE)
- permissions_json (NVARCHAR(MAX)) -- JSON array
- cached_at (DATETIME2)
- expires_at (DATETIME2)
```

## Installation Steps

### Step 1: Connect to SQL Server

```bash
# Option 1: SQL Server Management Studio (SSMS)
# - Open SSMS
# - Connect to your SQL Server instance
# - Open the migration files

# Option 2: sqlcmd (command line)
sqlcmd -S localhost -U sa -P YourPassword -d AssetManagement
```

### Step 2: Update Database Name

Before running the scripts, update the database name in both files:

```sql
USE [AssetManagement]; -- Change to your database name
```

### Step 3: Run Migration Scripts (IN ORDER)

**⚠️ IMPORTANT: Execute scripts in this exact order!**

#### 1. Create Tables
```sql
-- Execute: 001_permission_system.sql
-- This creates all the tables
```

#### 2. Seed Data
```sql
-- Execute: 002_permission_seed_data.sql
-- This populates the tables with initial data
```

### Step 4: Verify Installation

Run these queries to verify the setup:

```sql
-- Check permission categories
SELECT COUNT(*) as category_count FROM PERMISSION_CATEGORIES;
-- Expected: 8 categories

-- Check permissions
SELECT COUNT(*) as permission_count FROM PERMISSIONS;
-- Expected: 50+ permissions

-- Check role templates
SELECT role_name, display_name, hierarchy_level FROM ROLE_TEMPLATES ORDER BY hierarchy_level DESC;
-- Expected: 7 roles (superadmin, admin, dept_head, coordinator, dept_coordinator, engineer, employee)

-- Check role permissions
SELECT rt.role_name, COUNT(rp.permission_id) as permission_count
FROM ROLE_TEMPLATES rt
LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id
GROUP BY rt.role_name
ORDER BY COUNT(rp.permission_id) DESC;
-- Expected: superadmin should have the most permissions

-- Verify user table column
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'USER_MASTER' AND COLUMN_NAME = 'has_custom_permissions';
-- Expected: 1 row
```

## Permission System Architecture

### Effective Permissions Calculation

A user's effective permissions are calculated as:

```
Effective Permissions = (Role Default Permissions) + (Custom Granted Permissions) - (Custom Revoked Permissions)
```

**Example:**
- User has role "coordinator" (default permissions: assets.read, assets.create, assets.update)
- Custom granted: users.read (granted by admin)
- Custom revoked: assets.delete (revoked by admin)
- **Effective**: assets.read, assets.create, assets.update, users.read

### Permission Key Format

Permissions follow the format: `resource.action`

Examples:
- `users.create` - Create new users
- `assets.read` - View assets
- `masters.oem.manage` - Full access to OEM master data
- `system.settings` - Access system settings

### Role Hierarchy

```
Level 100: superadmin (can do everything)
Level 90:  admin (cannot delete users or modify superadmin)
Level 70:  department_head (department-scoped management)
Level 60:  coordinator (asset and ticket coordination)
Level 50:  department_coordinator (department-scoped coordination)
Level 30:  engineer (technical support)
Level 10:  employee (basic access)
```

Users can only manage other users with lower hierarchy levels.

## Default Role Permissions

### Superadmin
- **All Permissions** (complete system access)

### Admin
- All permissions except:
  - users.delete
  - system.backup
  - permission-control.delete

### Department Head
- User: read, update
- Asset: read, assign, transfer
- Department: read, update
- Ticket: create, read, update, assign
- Reports: view, dashboard

### Coordinator
- Asset: create, read, update, assign, maintenance
- Ticket: create, read, update
- Reports: view

### Department Coordinator
- Asset: read, assign, maintenance
- Ticket: create, read, update
- Reports: view

### Engineer
- Ticket: read, update
- Asset: read, maintenance
- Reports: view

### Employee
- Asset: read
- Ticket: create, read
- Reports: view

## Modifying Permissions

### Via SuperAdmin Panel (Recommended)

1. Log in as superadmin
2. Navigate to `/settings/permission-control`
3. Select a role to modify
4. Check/uncheck permissions
5. Click "Save Changes"

### Via Database (Advanced)

**⚠️ Only modify database directly if you know what you're doing!**

#### Add permission to role:
```sql
DECLARE @roleId UNIQUEIDENTIFIER = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'coordinator');
DECLARE @permId UNIQUEIDENTIFIER = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'users.create');

INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id)
VALUES (@roleId, @permId);
```

#### Remove permission from role:
```sql
DELETE FROM ROLE_PERMISSIONS
WHERE role_template_id = (SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'coordinator')
  AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'users.create');
```

## Troubleshooting

### Issue: Tables already exist

```sql
-- Drop existing tables (⚠️ THIS WILL DELETE ALL DATA!)
DROP TABLE IF EXISTS PERMISSION_AUDIT_LOG;
DROP TABLE IF EXISTS PERMISSION_CACHE;
DROP TABLE IF EXISTS USER_CUSTOM_PERMISSIONS;
DROP TABLE IF EXISTS ROLE_PERMISSIONS;
DROP TABLE IF EXISTS ROLE_TEMPLATES;
DROP TABLE IF EXISTS PERMISSIONS;
DROP TABLE IF EXISTS PERMISSION_CATEGORIES;

-- Then re-run 001_permission_system.sql
```

### Issue: Permission checks failing

```sql
-- Clear permission cache
DELETE FROM PERMISSION_CACHE;

-- Or via API:
POST /admin/permissions/cache/clear
```

### Issue: User has no permissions

```sql
-- Check user's role
SELECT user_id, role, has_custom_permissions FROM USER_MASTER WHERE email = 'user@example.com';

-- Check role permissions
SELECT p.permission_key
FROM ROLE_PERMISSIONS rp
INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
WHERE rt.role_name = 'coordinator'; -- Replace with user's role

-- Check custom permissions
SELECT p.permission_key, ucp.is_granted
FROM USER_CUSTOM_PERMISSIONS ucp
INNER JOIN PERMISSIONS p ON ucp.permission_id = p.permission_id
WHERE ucp.user_id = 'USER_UUID_HERE';
```

## Performance Considerations

### Indexes

All tables have appropriate indexes for:
- Primary keys
- Foreign keys
- Frequently queried columns (role_name, permission_key, user_id)

### Caching

The application caches permissions for 5 minutes to reduce database load:
- User permissions cached per user
- Role permissions cached per role
- Cache is automatically invalidated when permissions change

### Database Maintenance

```sql
-- Rebuild indexes monthly
ALTER INDEX ALL ON PERMISSIONS REBUILD;
ALTER INDEX ALL ON ROLE_PERMISSIONS REBUILD;
ALTER INDEX ALL ON USER_CUSTOM_PERMISSIONS REBUILD;

-- Update statistics
UPDATE STATISTICS PERMISSIONS;
UPDATE STATISTICS ROLE_PERMISSIONS;
UPDATE STATISTICS USER_CUSTOM_PERMISSIONS;

-- Clean up expired permissions
DELETE FROM USER_CUSTOM_PERMISSIONS
WHERE expires_at IS NOT NULL AND expires_at < GETUTCDATE();

-- Archive old audit logs (older than 1 year)
DELETE FROM PERMISSION_AUDIT_LOG
WHERE performed_at < DATEADD(YEAR, -1, GETUTCDATE());
```

## Security Best Practices

1. **Never modify superadmin role** - It should always have all permissions
2. **Document permission changes** - Always provide a reason when granting/revoking
3. **Use role permissions first** - Only use custom permissions for exceptions
4. **Regular audits** - Review permission audit logs weekly
5. **Least privilege principle** - Grant minimum permissions needed
6. **Temporary grants** - Use expiration dates for temporary access

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review audit logs: `SELECT * FROM PERMISSION_AUDIT_LOG ORDER BY performed_at DESC`
3. Contact system administrator
