-- ============================================================================
-- Migration: Add Parent-Child Asset Hierarchy Support
-- Description: Enables tracking of components installed within assets
-- Version: 001
-- Date: 2025-10-20
-- ============================================================================

USE asset_management;
GO

-- ============================================================================
-- STEP 1: Add new columns to assets table
-- ============================================================================

PRINT 'Adding new columns to assets table...';

-- Add parent_asset_id for component hierarchy
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets' AND COLUMN_NAME = 'parent_asset_id'
)
BEGIN
    ALTER TABLE assets
    ADD parent_asset_id UNIQUEIDENTIFIER NULL;
    PRINT '✓ Added parent_asset_id column';
END
ELSE
BEGIN
    PRINT '⊘ Column parent_asset_id already exists';
END
GO

-- Add asset_type to distinguish between parent/component/standalone
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets' AND COLUMN_NAME = 'asset_type'
)
BEGIN
    ALTER TABLE assets
    ADD asset_type VARCHAR(20) DEFAULT 'standalone' NOT NULL
    CHECK (asset_type IN ('standalone', 'parent', 'component'));
    PRINT '✓ Added asset_type column with constraint';
END
ELSE
BEGIN
    PRINT '⊘ Column asset_type already exists';
END
GO

-- Add installation_date for component tracking
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets' AND COLUMN_NAME = 'installation_date'
)
BEGIN
    ALTER TABLE assets
    ADD installation_date DATETIME NULL;
    PRINT '✓ Added installation_date column';
END
ELSE
BEGIN
    PRINT '⊘ Column installation_date already exists';
END
GO

-- Add removal_date for component tracking
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets' AND COLUMN_NAME = 'removal_date'
)
BEGIN
    ALTER TABLE assets
    ADD removal_date DATETIME NULL;
    PRINT '✓ Added removal_date column';
END
ELSE
BEGIN
    PRINT '⊘ Column removal_date already exists';
END
GO

-- Add installation_notes for component tracking
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets' AND COLUMN_NAME = 'installation_notes'
)
BEGIN
    ALTER TABLE assets
    ADD installation_notes TEXT NULL;
    PRINT '✓ Added installation_notes column';
END
ELSE
BEGIN
    PRINT '⊘ Column installation_notes already exists';
END
GO

-- Add installed_by to track who installed the component
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'assets' AND COLUMN_NAME = 'installed_by'
)
BEGIN
    ALTER TABLE assets
    ADD installed_by UNIQUEIDENTIFIER NULL;
    PRINT '✓ Added installed_by column';
END
ELSE
BEGIN
    PRINT '⊘ Column installed_by already exists';
END
GO

-- ============================================================================
-- STEP 2: Add foreign key constraints
-- ============================================================================

PRINT 'Adding foreign key constraints...';

-- Foreign key: parent_asset_id references assets(id)
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_NAME = 'FK_assets_parent_asset'
)
BEGIN
    ALTER TABLE assets
    ADD CONSTRAINT FK_assets_parent_asset
    FOREIGN KEY (parent_asset_id) REFERENCES assets(id);
    PRINT '✓ Added FK_assets_parent_asset constraint';
END
ELSE
BEGIN
    PRINT '⊘ Constraint FK_assets_parent_asset already exists';
END
GO

-- Foreign key: installed_by references USER_MASTER(user_id)
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_NAME = 'FK_assets_installed_by'
)
BEGIN
    ALTER TABLE assets
    ADD CONSTRAINT FK_assets_installed_by
    FOREIGN KEY (installed_by) REFERENCES USER_MASTER(user_id);
    PRINT '✓ Added FK_assets_installed_by constraint';
END
ELSE
BEGIN
    PRINT '⊘ Constraint FK_assets_installed_by already exists';
END
GO

-- ============================================================================
-- STEP 3: Create indexes for performance
-- ============================================================================

PRINT 'Creating indexes for performance optimization...';

-- Index on parent_asset_id for fast component lookups
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_assets_parent_asset_id' AND object_id = OBJECT_ID('assets')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_assets_parent_asset_id
    ON assets(parent_asset_id)
    WHERE parent_asset_id IS NOT NULL;
    PRINT '✓ Created index IX_assets_parent_asset_id';
END
ELSE
BEGIN
    PRINT '⊘ Index IX_assets_parent_asset_id already exists';
END
GO

-- Index on asset_type for filtering
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_assets_asset_type' AND object_id = OBJECT_ID('assets')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_assets_asset_type
    ON assets(asset_type)
    INCLUDE (parent_asset_id, installation_date);
    PRINT '✓ Created index IX_assets_asset_type';
END
ELSE
BEGIN
    PRINT '⊘ Index IX_assets_asset_type already exists';
END
GO

-- Composite index for active components
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_assets_parent_active' AND object_id = OBJECT_ID('assets')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_assets_parent_active
    ON assets(parent_asset_id, is_active, asset_type)
    WHERE parent_asset_id IS NOT NULL AND is_active = 1;
    PRINT '✓ Created index IX_assets_parent_active';
END
ELSE
BEGIN
    PRINT '⊘ Index IX_assets_parent_active already exists';
END
GO

-- ============================================================================
-- STEP 4: Add check constraints for business rules
-- ============================================================================

PRINT 'Adding business rule constraints...';

-- Constraint: Components cannot be assigned to users (only parents can)
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_NAME = 'CHK_component_not_assigned'
)
BEGIN
    ALTER TABLE assets
    ADD CONSTRAINT CHK_component_not_assigned
    CHECK (
        (asset_type != 'component') OR
        (asset_type = 'component' AND assigned_to IS NULL)
    );
    PRINT '✓ Added CHK_component_not_assigned constraint';
END
ELSE
BEGIN
    PRINT '⊘ Constraint CHK_component_not_assigned already exists';
END
GO

-- Constraint: Components must have a parent
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_NAME = 'CHK_component_has_parent'
)
BEGIN
    ALTER TABLE assets
    ADD CONSTRAINT CHK_component_has_parent
    CHECK (
        (asset_type != 'component') OR
        (asset_type = 'component' AND parent_asset_id IS NOT NULL)
    );
    PRINT '✓ Added CHK_component_has_parent constraint';
END
ELSE
BEGIN
    PRINT '⊘ Constraint CHK_component_has_parent already exists';
END
GO

-- Constraint: Standalone and parent assets cannot have parent_asset_id
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_NAME = 'CHK_non_component_no_parent'
)
BEGIN
    ALTER TABLE assets
    ADD CONSTRAINT CHK_non_component_no_parent
    CHECK (
        (asset_type = 'component') OR
        (asset_type IN ('standalone', 'parent') AND parent_asset_id IS NULL)
    );
    PRINT '✓ Added CHK_non_component_no_parent constraint';
END
ELSE
BEGIN
    PRINT '⊘ Constraint CHK_non_component_no_parent already exists';
END
GO

-- ============================================================================
-- STEP 5: Data migration - Set existing assets to 'standalone'
-- ============================================================================

PRINT 'Migrating existing data...';

-- Update existing assets without components to 'standalone'
UPDATE assets
SET asset_type = 'standalone'
WHERE asset_type IS NULL OR asset_type = 'standalone';

PRINT '✓ Updated existing assets to standalone type';
GO

-- ============================================================================
-- STEP 6: Create helper views for component management
-- ============================================================================

PRINT 'Creating helper views...';

-- View: Assets with component count
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_assets_with_component_count')
BEGIN
    DROP VIEW vw_assets_with_component_count;
END
GO

CREATE VIEW vw_assets_with_component_count AS
SELECT
    a.id,
    a.asset_tag,
    a.asset_type,
    a.serial_number,
    a.status,
    a.assigned_to,
    p.name as product_name,
    p.model as product_model,
    (
        SELECT COUNT(*)
        FROM assets c
        WHERE c.parent_asset_id = a.id
          AND c.is_active = 1
          AND c.removal_date IS NULL
    ) as installed_component_count,
    a.created_at,
    a.updated_at
FROM assets a
INNER JOIN products p ON a.product_id = p.id
WHERE a.is_active = 1;
GO

PRINT '✓ Created view vw_assets_with_component_count';
GO

-- View: Component installation history
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_component_installation_history')
BEGIN
    DROP VIEW vw_component_installation_history;
END
GO

CREATE VIEW vw_component_installation_history AS
SELECT
    c.id as component_id,
    c.asset_tag as component_tag,
    c.serial_number as component_serial,
    cp.name as component_product,
    c.installation_date,
    c.removal_date,
    c.installation_notes,
    p.id as parent_id,
    p.asset_tag as parent_tag,
    pp.name as parent_product,
    u.first_name + ' ' + u.last_name as installed_by_name,
    c.created_at
FROM assets c
INNER JOIN products cp ON c.product_id = cp.id
LEFT JOIN assets p ON c.parent_asset_id = p.id
LEFT JOIN products pp ON p.product_id = pp.id
LEFT JOIN USER_MASTER u ON c.installed_by = u.user_id
WHERE c.asset_type = 'component' AND c.is_active = 1;
GO

PRINT '✓ Created view vw_component_installation_history';
GO

-- ============================================================================
-- STEP 7: Create stored procedures for component operations
-- ============================================================================

PRINT 'Creating stored procedures...';

-- Procedure: Get asset hierarchy tree
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_get_asset_hierarchy')
BEGIN
    DROP PROCEDURE sp_get_asset_hierarchy;
END
GO

CREATE PROCEDURE sp_get_asset_hierarchy
    @asset_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Recursive CTE to get full hierarchy
    WITH AssetHierarchy AS (
        -- Anchor: Start with requested asset
        SELECT
            a.id,
            a.asset_tag,
            a.asset_type,
            a.parent_asset_id,
            p.name as product_name,
            p.model as product_model,
            a.serial_number,
            a.installation_date,
            a.removal_date,
            0 as level,
            CAST(a.asset_tag AS VARCHAR(MAX)) as path
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        WHERE a.id = @asset_id AND a.is_active = 1

        UNION ALL

        -- Recursive: Get all child components
        SELECT
            c.id,
            c.asset_tag,
            c.asset_type,
            c.parent_asset_id,
            p.name as product_name,
            p.model as product_model,
            c.serial_number,
            c.installation_date,
            c.removal_date,
            h.level + 1,
            h.path + ' > ' + c.asset_tag
        FROM assets c
        INNER JOIN products p ON c.product_id = p.id
        INNER JOIN AssetHierarchy h ON c.parent_asset_id = h.id
        WHERE c.is_active = 1 AND c.removal_date IS NULL
    )
    SELECT * FROM AssetHierarchy
    ORDER BY level, asset_tag;
END
GO

PRINT '✓ Created procedure sp_get_asset_hierarchy';
GO

-- Procedure: Validate component installation
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_validate_component_installation')
BEGIN
    DROP PROCEDURE sp_validate_component_installation;
END
GO

CREATE PROCEDURE sp_validate_component_installation
    @component_id UNIQUEIDENTIFIER,
    @parent_id UNIQUEIDENTIFIER,
    @is_valid BIT OUTPUT,
    @error_message VARCHAR(500) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @is_valid = 1;
    SET @error_message = NULL;

    -- Check 1: Component must exist and be active
    IF NOT EXISTS (SELECT 1 FROM assets WHERE id = @component_id AND is_active = 1)
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Component asset not found or inactive';
        RETURN;
    END

    -- Check 2: Parent must exist and be active
    IF NOT EXISTS (SELECT 1 FROM assets WHERE id = @parent_id AND is_active = 1)
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Parent asset not found or inactive';
        RETURN;
    END

    -- Check 3: Component must be available or standalone
    IF EXISTS (
        SELECT 1 FROM assets
        WHERE id = @component_id
          AND parent_asset_id IS NOT NULL
          AND removal_date IS NULL
    )
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Component is already installed in another asset';
        RETURN;
    END

    -- Check 4: Prevent self-reference
    IF @component_id = @parent_id
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'An asset cannot be installed into itself';
        RETURN;
    END

    -- Check 5: Prevent circular dependency
    IF EXISTS (
        WITH ParentChain AS (
            SELECT parent_asset_id, id FROM assets WHERE id = @parent_id
            UNION ALL
            SELECT a.parent_asset_id, a.id
            FROM assets a
            INNER JOIN ParentChain pc ON a.id = pc.parent_asset_id
        )
        SELECT 1 FROM ParentChain WHERE parent_asset_id = @component_id
    )
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'This installation would create a circular dependency';
        RETURN;
    END

    -- Check 6: Parent cannot be a component
    IF EXISTS (SELECT 1 FROM assets WHERE id = @parent_id AND asset_type = 'component')
    BEGIN
        SET @is_valid = 0;
        SET @error_message = 'Cannot install components into another component. Install into the parent asset instead.';
        RETURN;
    END
END
GO

PRINT '✓ Created procedure sp_validate_component_installation';
GO

-- ============================================================================
-- STEP 8: Create triggers for data consistency
-- ============================================================================

PRINT 'Creating triggers for data consistency...';

-- Trigger: Auto-update parent asset_type when components added
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_assets_update_parent_type')
BEGIN
    DROP TRIGGER tr_assets_update_parent_type;
END
GO

CREATE TRIGGER tr_assets_update_parent_type
ON assets
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Update parent to 'parent' type when component is installed
    UPDATE a
    SET a.asset_type = 'parent',
        a.updated_at = GETUTCDATE()
    FROM assets a
    INNER JOIN inserted i ON a.id = i.parent_asset_id
    WHERE i.asset_type = 'component'
      AND i.removal_date IS NULL
      AND a.asset_type = 'standalone';

    -- Revert parent to 'standalone' if no active components remain
    UPDATE a
    SET a.asset_type = 'standalone',
        a.updated_at = GETUTCDATE()
    FROM assets a
    WHERE a.asset_type = 'parent'
      AND NOT EXISTS (
          SELECT 1 FROM assets c
          WHERE c.parent_asset_id = a.id
            AND c.is_active = 1
            AND c.removal_date IS NULL
      );
END
GO

PRINT '✓ Created trigger tr_assets_update_parent_type';
GO

-- ============================================================================
-- Migration Complete
-- ============================================================================

PRINT '';
PRINT '========================================';
PRINT 'Migration completed successfully! ✓';
PRINT '========================================';
PRINT '';
PRINT 'Summary of changes:';
PRINT '  • Added 6 new columns to assets table';
PRINT '  • Created 2 foreign key constraints';
PRINT '  • Created 3 performance indexes';
PRINT '  • Added 3 check constraints for business rules';
PRINT '  • Created 2 helper views';
PRINT '  • Created 2 stored procedures';
PRINT '  • Created 1 trigger for data consistency';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Update backend API endpoints';
PRINT '  2. Update validators';
PRINT '  3. Create component management UI';
PRINT '';
GO
