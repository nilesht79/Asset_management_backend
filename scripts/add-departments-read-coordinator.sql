-- Add departments.read permission to coordinator role
-- This allows coordinators to view the departments list in filters and dropdowns

USE asset_management;
GO

DECLARE @permissionId UNIQUEIDENTIFIER;
DECLARE @roleId UNIQUEIDENTIFIER;

-- Get the departments.read permission ID
SELECT @permissionId = permission_id
FROM PERMISSIONS
WHERE permission_key = 'departments.read';

-- Get the coordinator role ID
SELECT @roleId = role_id
FROM ROLES
WHERE role_name = 'coordinator';

-- Check if permission and role exist
IF @permissionId IS NULL
BEGIN
    PRINT 'ERROR: departments.read permission not found in PERMISSIONS table';
END
ELSE IF @roleId IS NULL
BEGIN
    PRINT 'ERROR: coordinator role not found in ROLES table';
END
ELSE
BEGIN
    -- Check if permission already exists for this role
    IF EXISTS (
        SELECT 1 FROM ROLE_PERMISSIONS
        WHERE role_id = @roleId AND permission_id = @permissionId
    )
    BEGIN
        PRINT 'departments.read permission already exists for coordinator role';
    END
    ELSE
    BEGIN
        -- Add the permission
        INSERT INTO ROLE_PERMISSIONS (
            role_permission_id,
            role_id,
            permission_id,
            created_at,
            updated_at
        )
        VALUES (
            NEWID(),
            @roleId,
            @permissionId,
            GETDATE(),
            GETDATE()
        );

        PRINT 'SUCCESS: departments.read permission added to coordinator role';
    END
END

-- Verify the permission was added
SELECT
    r.role_name,
    p.permission_key,
    p.permission_name,
    rp.created_at
FROM ROLE_PERMISSIONS rp
INNER JOIN ROLES r ON rp.role_id = r.role_id
INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
WHERE r.role_name = 'coordinator'
  AND p.permission_key = 'departments.read';

PRINT '';
PRINT 'Verification complete. If you see a row above, the permission was added successfully.';
GO
