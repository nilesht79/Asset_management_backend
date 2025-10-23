const { connectDB, sql } = require('./src/config/database');

async function verifyBoardPermissions() {
  console.log('✅ Verifying Board Permissions Configuration\n');
  console.log('='.repeat(80));

  try {
    const pool = await connectDB();
    let allChecks = [];

    // CHECK 1: Board permissions exist
    console.log('\n📋 CHECK 1: Board Permissions Exist');
    console.log('-'.repeat(80));
    const permissionsResult = await pool.request().query(`
      SELECT permission_key, permission_name, description, is_active
      FROM PERMISSIONS
      WHERE permission_key LIKE 'boards.%'
      ORDER BY permission_key
    `);

    const expectedPermissions = ['boards.read', 'boards.create', 'boards.update', 'boards.delete'];
    const foundPermissions = permissionsResult.recordset.map(p => p.permission_key);

    console.table(permissionsResult.recordset);

    const missingPermissions = expectedPermissions.filter(p => !foundPermissions.includes(p));
    if (missingPermissions.length === 0) {
      console.log('✅ All 4 board permissions exist');
      allChecks.push({ check: 'Board permissions exist', status: 'PASS' });
    } else {
      console.log(`❌ Missing permissions: ${missingPermissions.join(', ')}`);
      allChecks.push({ check: 'Board permissions exist', status: 'FAIL' });
    }

    // CHECK 2: Admin role has all board permissions
    console.log('\n📋 CHECK 2: Admin Role Permissions');
    console.log('-'.repeat(80));
    const adminPermsResult = await pool.request().query(`
      SELECT p.permission_key
      FROM ROLE_PERMISSIONS rp
      INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
      INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
      WHERE rt.role_name = 'admin'
      AND p.permission_key LIKE 'boards.%'
      ORDER BY p.permission_key
    `);

    const adminPerms = adminPermsResult.recordset.map(p => p.permission_key);
    console.log(`Admin has ${adminPerms.length}/4 board permissions: ${adminPerms.join(', ')}`);

    if (adminPerms.length === 4) {
      console.log('✅ Admin has all board permissions');
      allChecks.push({ check: 'Admin has all board permissions', status: 'PASS' });
    } else {
      console.log('❌ Admin is missing board permissions');
      allChecks.push({ check: 'Admin has all board permissions', status: 'FAIL' });
    }

    // CHECK 3: Superadmin role has all board permissions
    console.log('\n📋 CHECK 3: Superadmin Role Permissions');
    console.log('-'.repeat(80));
    const superadminPermsResult = await pool.request().query(`
      SELECT p.permission_key
      FROM ROLE_PERMISSIONS rp
      INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
      INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
      WHERE rt.role_name = 'superadmin'
      AND p.permission_key LIKE 'boards.%'
      ORDER BY p.permission_key
    `);

    const superadminPerms = superadminPermsResult.recordset.map(p => p.permission_key);
    console.log(`Superadmin has ${superadminPerms.length}/4 board permissions: ${superadminPerms.join(', ')}`);

    if (superadminPerms.length === 4) {
      console.log('✅ Superadmin has all board permissions');
      allChecks.push({ check: 'Superadmin has all board permissions', status: 'PASS' });
    } else {
      console.log('❌ Superadmin is missing board permissions');
      allChecks.push({ check: 'Superadmin has all board permissions', status: 'FAIL' });
    }

    // CHECK 4: Coordinator role has all board permissions
    console.log('\n📋 CHECK 4: Coordinator Role Permissions');
    console.log('-'.repeat(80));
    const coordinatorPermsResult = await pool.request().query(`
      SELECT p.permission_key
      FROM ROLE_PERMISSIONS rp
      INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
      INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
      WHERE rt.role_name = 'coordinator'
      AND p.permission_key LIKE 'boards.%'
      ORDER BY p.permission_key
    `);

    const coordinatorPerms = coordinatorPermsResult.recordset.map(p => p.permission_key);
    console.log(`Coordinator has ${coordinatorPerms.length}/4 board permissions: ${coordinatorPerms.join(', ')}`);

    if (coordinatorPerms.length === 4) {
      console.log('✅ Coordinator has all board permissions');
      allChecks.push({ check: 'Coordinator has all board permissions', status: 'PASS' });
    } else {
      console.log('❌ Coordinator is missing board permissions');
      allChecks.push({ check: 'Coordinator has all board permissions', status: 'FAIL' });
    }

    // CHECK 5: Complete role permission matrix
    console.log('\n📋 CHECK 5: Complete Permission Matrix');
    console.log('-'.repeat(80));
    const matrixResult = await pool.request().query(`
      SELECT
        rt.role_name,
        p.permission_key,
        CASE WHEN rp.role_permission_id IS NOT NULL THEN '✓' ELSE '-' END as has_permission
      FROM ROLE_TEMPLATES rt
      CROSS JOIN (
        SELECT DISTINCT permission_key
        FROM PERMISSIONS
        WHERE permission_key LIKE 'boards.%'
      ) p
      LEFT JOIN PERMISSIONS perm ON p.permission_key = perm.permission_key
      LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id AND rp.permission_id = perm.permission_id
      WHERE rt.role_name IN ('superadmin', 'admin', 'coordinator', 'it_head', 'department_head', 'employee')
      ORDER BY rt.role_name, p.permission_key
    `);

    // Create a matrix view
    const matrix = {};
    matrixResult.recordset.forEach(row => {
      if (!matrix[row.role_name]) {
        matrix[row.role_name] = {};
      }
      matrix[row.role_name][row.permission_key] = row.has_permission;
    });

    console.log('\nPermission Matrix (✓ = has permission, - = no permission):');
    console.table(matrix);

    // CHECK 6: Summary
    console.log('\n📋 CHECK 6: Summary');
    console.log('-'.repeat(80));
    const summaryResult = await pool.request().query(`
      SELECT
        rt.role_name,
        COUNT(rp.permission_id) as board_permission_count
      FROM ROLE_TEMPLATES rt
      LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id
      LEFT JOIN PERMISSIONS p ON rp.permission_id = p.permission_id AND p.permission_key LIKE 'boards.%'
      WHERE rt.is_active = 1
      GROUP BY rt.role_name
      ORDER BY board_permission_count DESC, rt.role_name
    `);

    console.table(summaryResult.recordset);

    // Final Results
    console.log('\n' + '='.repeat(80));
    console.log('📊 VERIFICATION RESULTS');
    console.log('='.repeat(80));
    console.table(allChecks);

    const failedChecks = allChecks.filter(c => c.status === 'FAIL');
    if (failedChecks.length === 0) {
      console.log('\n✅ ALL CHECKS PASSED! Board permissions are correctly configured.');
    } else {
      console.log(`\n❌ ${failedChecks.length} CHECK(S) FAILED!`);
    }

    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.error('\n❌ Verification Error:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

verifyBoardPermissions();
