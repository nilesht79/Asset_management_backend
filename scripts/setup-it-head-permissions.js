const { connectDB, sql } = require('../src/config/database');

// IT Head permissions as defined in auth.js ROLE_PERMISSIONS
const itHeadPermissions = [
  // User management (read only)
  'users.read',
  'users.update',

  // Asset management
  'assets.create',
  'assets.read',
  'assets.update',
  'assets.assign',
  'assets.transfer',
  'assets.maintenance',

  // Master data
  'masters.read',
  'masters.create',
  'masters.update',

  // Department management (read only)
  'departments.read',

  // Ticket management
  'tickets.create',
  'tickets.read',
  'tickets.update',
  'tickets.assign',

  // Reporting
  'reports.view',
  'reports.export',
  'reports.dashboard',

  // Statistics
  'statistics.read',

  // Requisitions (already assigned)
  'requisitions.create',
  'requisitions.read',
  'requisitions.approve.it'
];

async function setupITHeadPermissions() {
  try {
    const pool = await connectDB();
    console.log('Setting up IT Head permissions...\n');

    // Get IT Head role
    const roleResult = await pool.request()
      .query("SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'it_head'");

    if (roleResult.recordset.length === 0) {
      console.log('❌ IT Head role not found. Please run add-it-head-role.js first.');
      process.exit(1);
    }

    const itHeadRoleId = roleResult.recordset[0].role_template_id;
    console.log(`✓ Found IT Head role: ${itHeadRoleId}\n`);

    let assigned = 0;
    let alreadyAssigned = 0;
    let notFound = 0;

    for (const permKey of itHeadPermissions) {
      // Get permission ID
      const permResult = await pool.request()
        .input('key', sql.VarChar, permKey)
        .query('SELECT permission_id FROM PERMISSIONS WHERE permission_key = @key');

      if (permResult.recordset.length === 0) {
        console.log(`  ⚠️  Permission not found: ${permKey}`);
        notFound++;
        continue;
      }

      const permissionId = permResult.recordset[0].permission_id;

      // Check if already assigned
      const existsResult = await pool.request()
        .input('roleId', sql.UniqueIdentifier, itHeadRoleId)
        .input('permId', sql.UniqueIdentifier, permissionId)
        .query('SELECT 1 FROM ROLE_PERMISSIONS WHERE role_template_id = @roleId AND permission_id = @permId');

      if (existsResult.recordset.length > 0) {
        console.log(`  ℹ️  Already assigned: ${permKey}`);
        alreadyAssigned++;
        continue;
      }

      // Assign permission
      await pool.request()
        .input('roleId', sql.UniqueIdentifier, itHeadRoleId)
        .input('permId', sql.UniqueIdentifier, permissionId)
        .query(`
          INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id, granted_at)
          VALUES (@roleId, @permId, GETUTCDATE())
        `);

      console.log(`  ✅ Assigned: ${permKey}`);
      assigned++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Setup completed!`);
    console.log(`   - Assigned: ${assigned}`);
    console.log(`   - Already assigned: ${alreadyAssigned}`);
    console.log(`   - Not found: ${notFound}`);
    console.log(`   - Total: ${itHeadPermissions.length}`);

    // Show final permission count
    const finalCount = await pool.request()
      .input('roleId', sql.UniqueIdentifier, itHeadRoleId)
      .query('SELECT COUNT(*) as total FROM ROLE_PERMISSIONS WHERE role_template_id = @roleId');

    console.log(`\n📊 IT Head now has ${finalCount.recordset[0].total} total permissions`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error setting up IT Head permissions:', error);
    process.exit(1);
  }
}

setupITHeadPermissions();
