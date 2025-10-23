-- Add requisition permissions

-- First, create a category for requisitions if it doesn't exist
IF NOT EXISTS (SELECT 1 FROM PERMISSION_CATEGORIES WHERE category_name = 'Requisitions')
BEGIN
    INSERT INTO PERMISSION_CATEGORIES (category_name, description, display_order, is_active, created_at, updated_at)
    VALUES ('Requisitions', 'Asset requisition and approval permissions', 10, 1, GETUTCDATE(), GETUTCDATE());
END

DECLARE @category_id UNIQUEIDENTIFIER;
SELECT @category_id = category_id FROM PERMISSION_CATEGORIES WHERE category_name = 'Requisitions';

-- Add requisition permissions
IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.create')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.create', 'Create Requisitions', 'Create new asset requisitions', @category_id, 'requisitions', 'create', 1, 1, 1, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.view')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.view', 'View Requisitions', 'View own requisitions', @category_id, 'requisitions', 'view', 1, 1, 2, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.cancel')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.cancel', 'Cancel Requisitions', 'Cancel own requisitions', @category_id, 'requisitions', 'cancel', 1, 1, 3, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.approve.dept')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.approve.dept', 'Approve Department Requisitions', 'Approve or reject requisitions as Department Head', @category_id, 'requisitions', 'approve', 1, 1, 4, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.approve.it')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.approve.it', 'Approve IT Requisitions', 'Approve or reject requisitions as IT Head', @category_id, 'requisitions', 'approve', 1, 1, 5, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.assign')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.assign', 'Assign Assets to Requisitions', 'Assign assets to approved requisitions', @category_id, 'requisitions', 'assign', 1, 1, 6, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.delivery.manage')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.delivery.manage', 'Manage Deliveries', 'Manage asset delivery tickets', @category_id, 'requisitions', 'manage', 1, 1, 7, GETUTCDATE(), GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM PERMISSIONS WHERE permission_key = 'requisitions.delivery.confirm')
BEGIN
    INSERT INTO PERMISSIONS (permission_key, permission_name, description, category_id, resource_type, action_type, is_system, is_active, display_order, created_at, updated_at)
    VALUES ('requisitions.delivery.confirm', 'Confirm Deliveries', 'Confirm receipt of delivered assets', @category_id, 'requisitions', 'confirm', 1, 1, 8, GETUTCDATE(), GETUTCDATE());
END

-- Assign permissions to roles
DECLARE @employee_role_id UNIQUEIDENTIFIER;
DECLARE @dept_head_role_id UNIQUEIDENTIFIER;
DECLARE @coordinator_role_id UNIQUEIDENTIFIER;
DECLARE @admin_role_id UNIQUEIDENTIFIER;
DECLARE @superadmin_role_id UNIQUEIDENTIFIER;

SELECT @employee_role_id = role_id FROM ROLES WHERE role_name = 'employee';
SELECT @dept_head_role_id = role_id FROM ROLES WHERE role_name = 'department_head';
SELECT @coordinator_role_id = role_id FROM ROLES WHERE role_name = 'coordinator';
SELECT @admin_role_id = role_id FROM ROLES WHERE role_name = 'admin';
SELECT @superadmin_role_id = role_id FROM ROLES WHERE role_name = 'superadmin';

-- Employee permissions
IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @employee_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.create'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@employee_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.create'), 1, GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @employee_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.view'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@employee_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.view'), 1, GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @employee_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.cancel'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@employee_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.cancel'), 1, GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @employee_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.delivery.confirm'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@employee_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.delivery.confirm'), 1, GETUTCDATE());
END

-- Department Head permissions
IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @dept_head_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.create'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@dept_head_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.create'), 1, GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @dept_head_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.view'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@dept_head_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.view'), 1, GETUTCDATE());
END

IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @dept_head_role_id AND permission_id = (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.approve.dept'))
BEGIN
    INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
    VALUES (@dept_head_role_id, (SELECT permission_id FROM PERMISSIONS WHERE permission_key = 'requisitions.approve.dept'), 1, GETUTCDATE());
END

-- Coordinator permissions (all requisition permissions)
DECLARE @perm_id UNIQUEIDENTIFIER;

DECLARE permission_cursor CURSOR FOR
SELECT permission_id FROM PERMISSIONS WHERE resource_type = 'requisitions';

OPEN permission_cursor;
FETCH NEXT FROM permission_cursor INTO @perm_id;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @coordinator_role_id AND permission_id = @perm_id)
    BEGIN
        INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
        VALUES (@coordinator_role_id, @perm_id, 1, GETUTCDATE());
    END

    IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @admin_role_id AND permission_id = @perm_id)
    BEGIN
        INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
        VALUES (@admin_role_id, @perm_id, 1, GETUTCDATE());
    END

    IF NOT EXISTS (SELECT 1 FROM ROLE_PERMISSIONS WHERE role_id = @superadmin_role_id AND permission_id = @perm_id)
    BEGIN
        INSERT INTO ROLE_PERMISSIONS (role_id, permission_id, is_active, created_at)
        VALUES (@superadmin_role_id, @perm_id, 1, GETUTCDATE());
    END

    FETCH NEXT FROM permission_cursor INTO @perm_id;
END

CLOSE permission_cursor;
DEALLOCATE permission_cursor;

PRINT 'Requisition permissions added successfully';
