const { connectDB } = require('../src/config/database');
const sql = require('mssql');

const rolePermissions = {
  employee: [
    'requisitions.create',
    'requisitions.view',
    'requisitions.cancel',
    'requisitions.delivery.confirm'
  ],
  department_head: [
    'requisitions.create',
    'requisitions.view',
    'requisitions.approve.dept'
  ],
  coordinator: [
    'requisitions.create',
    'requisitions.view',
    'requisitions.cancel',
    'requisitions.approve.dept',
    'requisitions.approve.it',
    'requisitions.assign',
    'requisitions.delivery.manage',
    'requisitions.delivery.confirm'
  ],
  admin: [
    'requisitions.create',
    'requisitions.view',
    'requisitions.cancel',
    'requisitions.approve.dept',
    'requisitions.approve.it',
    'requisitions.assign',
    'requisitions.delivery.manage',
    'requisitions.delivery.confirm'
  ],
  superadmin: [
    'requisitions.create',
    'requisitions.view',
    'requisitions.cancel',
    'requisitions.approve.dept',
    'requisitions.approve.it',
    'requisitions.assign',
    'requisitions.delivery.manage',
    'requisitions.delivery.confirm'
  ]
};

async function assignPermissions() {
  try {
    const pool = await connectDB();

    console.log('Starting permission assignment...\n');

    for (const [roleName, permissions] of Object.entries(rolePermissions)) {
      console.log(`Processing role: ${roleName}`);

      // Get role template ID
      const roleResult = await pool.request()
        .input('role_name', sql.VarChar, roleName)
        .query('SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = @role_name');

      if (roleResult.recordset.length === 0) {
        console.log(`  ⚠️  Role template not found: ${roleName}`);
        continue;
      }

      const roleTemplateId = roleResult.recordset[0].role_template_id;
      console.log(`  Role template ID: ${roleTemplateId}`);

      for (const permKey of permissions) {
        // Get permission ID
        const permResult = await pool.request()
          .input('perm_key', sql.VarChar, permKey)
          .query('SELECT permission_id FROM PERMISSIONS WHERE permission_key = @perm_key');

        if (permResult.recordset.length === 0) {
          console.log(`    ⚠️  Permission not found: ${permKey}`);
          continue;
        }

        const permissionId = permResult.recordset[0].permission_id;

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

      console.log('');
    }

    console.log('✅ Permission assignment completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error assigning permissions:', error);
    process.exit(1);
  }
}

assignPermissions();
