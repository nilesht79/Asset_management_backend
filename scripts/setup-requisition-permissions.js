const { connectDB } = require('../src/config/database');
const sql = require('mssql');

const permissions = [
  {
    key: 'requisitions.create',
    name: 'Create Requisitions',
    description: 'Create new asset requisitions',
    action: 'create'
  },
  {
    key: 'requisitions.read',
    name: 'View Requisitions',
    description: 'View own requisitions',
    action: 'read'
  },
  {
    key: 'requisitions.cancel',
    name: 'Cancel Requisitions',
    description: 'Cancel own requisitions',
    action: 'cancel'
  },
  {
    key: 'requisitions.approve.dept',
    name: 'Approve Department Requisitions',
    description: 'Approve or reject requisitions as Department Head',
    action: 'approve'
  },
  {
    key: 'requisitions.approve.it',
    name: 'Approve IT Requisitions',
    description: 'Approve or reject requisitions as IT Head',
    action: 'approve'
  },
  {
    key: 'requisitions.assign',
    name: 'Assign Assets to Requisitions',
    description: 'Assign assets to approved requisitions',
    action: 'assign'
  },
  {
    key: 'requisitions.delivery.manage',
    name: 'Manage Deliveries',
    description: 'Manage asset delivery tickets',
    action: 'manage'
  },
  {
    key: 'requisitions.delivery.confirm',
    name: 'Confirm Deliveries',
    description: 'Confirm receipt of delivered assets',
    action: 'confirm'
  }
];

const rolePermissions = {
  employee: [
    'requisitions.create',
    'requisitions.read',
    'requisitions.cancel',
    'requisitions.delivery.confirm'
  ],
  department_head: [
    'requisitions.create',
    'requisitions.read',
    'requisitions.approve.dept'
  ],
  it_head: [
    'requisitions.create',
    'requisitions.read',
    'requisitions.approve.it'
  ],
  coordinator: [
    'requisitions.create',
    'requisitions.read',
    'requisitions.cancel',
    'requisitions.approve.dept',
    'requisitions.approve.it',
    'requisitions.assign',
    'requisitions.delivery.manage',
    'requisitions.delivery.confirm'
  ],
  admin: [
    'requisitions.create',
    'requisitions.read',
    'requisitions.cancel',
    'requisitions.approve.dept',
    'requisitions.approve.it',
    'requisitions.assign',
    'requisitions.delivery.manage',
    'requisitions.delivery.confirm'
  ],
  superadmin: [
    'requisitions.create',
    'requisitions.read',
    'requisitions.cancel',
    'requisitions.approve.dept',
    'requisitions.approve.it',
    'requisitions.assign',
    'requisitions.delivery.manage',
    'requisitions.delivery.confirm'
  ]
};

async function setup() {
  try {
    const pool = await connectDB();

    console.log('Setting up requisition permissions...\n');

    // Step 1: Create or get category
    let categoryId;
    const catResult = await pool.request()
      .query("SELECT category_id FROM PERMISSION_CATEGORIES WHERE category_name = 'Requisitions'");

    if (catResult.recordset.length === 0) {
      const insertCat = await pool.request()
        .query(`
          INSERT INTO PERMISSION_CATEGORIES (category_key, category_name, description, display_order, is_active, created_at, updated_at)
          OUTPUT INSERTED.category_id
          VALUES ('requisitions', 'Requisitions', 'Asset requisition and approval permissions', 10, 1, GETUTCDATE(), GETUTCDATE())
        `);
      categoryId = insertCat.recordset[0].category_id;
      console.log('✅ Created Requisitions category');
    } else {
      categoryId = catResult.recordset[0].category_id;
      console.log('ℹ️  Requisitions category already exists');
    }

    // Step 2: Create permissions
    console.log('\nCreating permissions:');
    const permissionMap = {};

    for (const perm of permissions) {
      const existsResult = await pool.request()
        .input('key', sql.VarChar, perm.key)
        .query('SELECT permission_id FROM PERMISSIONS WHERE permission_key = @key');

      if (existsResult.recordset.length > 0) {
        permissionMap[perm.key] = existsResult.recordset[0].permission_id;
        console.log(`  ℹ️  Already exists: ${perm.key}`);
        continue;
      }

      const insertResult = await pool.request()
        .input('key', sql.VarChar, perm.key)
        .input('name', sql.NVarChar, perm.name)
        .input('desc', sql.NVarChar, perm.description)
        .input('cat_id', sql.UniqueIdentifier, categoryId)
        .input('action', sql.VarChar, perm.action)
        .query(`
          INSERT INTO PERMISSIONS (
            permission_key, permission_name, description, category_id,
            resource_type, action_type, is_system, is_active, created_at, updated_at
          )
          OUTPUT INSERTED.permission_id
          VALUES (
            @key, @name, @desc, @cat_id,
            'requisitions', @action, 1, 1, GETUTCDATE(), GETUTCDATE()
          )
        `);

      permissionMap[perm.key] = insertResult.recordset[0].permission_id;
      console.log(`  ✅ Created: ${perm.key}`);
    }

    // Step 3: Assign permissions to roles
    console.log('\nAssigning permissions to roles:');

    for (const [roleName, permKeys] of Object.entries(rolePermissions)) {
      console.log(`\nProcessing role: ${roleName}`);

      // Get role template ID
      const roleResult = await pool.request()
        .input('role_name', sql.VarChar, roleName)
        .query('SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = @role_name');

      if (roleResult.recordset.length === 0) {
        console.log(`  ⚠️  Role not found: ${roleName}`);
        continue;
      }

      const roleTemplateId = roleResult.recordset[0].role_template_id;

      for (const permKey of permKeys) {
        const permissionId = permissionMap[permKey];

        if (!permissionId) {
          console.log(`    ⚠️  Permission not in map: ${permKey}`);
          continue;
        }

        // Check if already assigned
        const existsResult = await pool.request()
          .input('role_id', sql.UniqueIdentifier, roleTemplateId)
          .input('perm_id', sql.UniqueIdentifier, permissionId)
          .query('SELECT 1 FROM ROLE_PERMISSIONS WHERE role_template_id = @role_id AND permission_id = @perm_id');

        if (existsResult.recordset.length > 0) {
          console.log(`    ℹ️  Already assigned: ${permKey}`);
          continue;
        }

        // Assign permission
        await pool.request()
          .input('role_id', sql.UniqueIdentifier, roleTemplateId)
          .input('perm_id', sql.UniqueIdentifier, permissionId)
          .query(`
            INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id, granted_at)
            VALUES (@role_id, @perm_id, GETUTCDATE())
          `);

        console.log(`    ✅ Assigned: ${permKey}`);
      }
    }

    console.log('\n✅ Requisition permissions setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error setting up permissions:', error);
    process.exit(1);
  }
}

setup();
