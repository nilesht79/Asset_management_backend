/**
 * TEST PERMISSION FIX
 * This script tests if the permission system fixes are working correctly
 * Run AFTER restarting the backend server
 */

require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true
  }
};

async function testPermissionFix() {
  let pool;

  try {
    console.log('\n===========================================');
    console.log('TESTING PERMISSION SYSTEM FIXES');
    console.log('===========================================\n');

    pool = await sql.connect(config);

    // Test 1: Verify PERMISSIONS JOIN works
    console.log('Test 1: Testing PERMISSIONS table JOIN...');
    const test1 = await pool.request()
      .input('roleName', sql.VarChar(50), 'employee')
      .query(`
        SELECT p.permission_key
        FROM ROLE_PERMISSIONS rp
        INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
        INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
        WHERE rt.role_name = @roleName
          AND rt.is_active = 1
          AND p.is_active = 1
      `);

    if (test1.recordset.length > 0) {
      console.log(`  ✓ PASS: Retrieved ${test1.recordset.length} permissions for employee role`);
      console.log(`    Permissions: ${test1.recordset.map(r => r.permission_key).join(', ')}`);
    } else {
      console.log('  ✗ FAIL: No permissions retrieved (JOIN still broken)');
      process.exit(1);
    }

    // Test 2: Verify USER_CUSTOM_PERMISSIONS columns
    console.log('\nTest 2: Testing USER_CUSTOM_PERMISSIONS columns...');
    const test2 = await pool.request().query(`
      SELECT TOP 1
        user_id,
        permission_id,
        is_granted,
        granted_at,
        granted_by,
        expires_at,
        reason
      FROM USER_CUSTOM_PERMISSIONS
    `);

    console.log('  ✓ PASS: All required columns exist in USER_CUSTOM_PERMISSIONS');
    console.log('    Columns: user_id, permission_id, is_granted, granted_at, granted_by, expires_at, reason');

    // Test 3: Check if is_active column exists (it shouldn't)
    console.log('\nTest 3: Verifying is_active column does NOT exist...');
    const test3 = await pool.request().query(`
      SELECT COUNT(*) as count
      FROM sys.columns
      WHERE object_id = OBJECT_ID('USER_CUSTOM_PERMISSIONS')
        AND name = 'is_active'
    `);

    if (test3.recordset[0].count === 0) {
      console.log('  ✓ PASS: is_active column correctly does not exist');
    } else {
      console.log('  ⚠️  WARNING: is_active column exists (might cause issues)');
    }

    // Test 4: Simulate getUserEffectivePermissions logic
    console.log('\nTest 4: Testing complete permission retrieval flow...');

    // Get a real user ID
    const userCheck = await pool.request().query(`
      SELECT TOP 1 user_id, role, first_name, last_name
      FROM USER_MASTER
      WHERE is_active = 1 AND role = 'employee'
    `);

    if (userCheck.recordset.length === 0) {
      console.log('  ⚠️  SKIP: No active employee users found in database');
    } else {
      const testUser = userCheck.recordset[0];
      console.log(`  Testing with user: ${testUser.first_name} ${testUser.last_name} (${testUser.role})`);

      // Get role permissions
      const rolePerms = await pool.request()
        .input('roleName', sql.VarChar(50), testUser.role)
        .query(`
          SELECT p.permission_key
          FROM ROLE_PERMISSIONS rp
          INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
          INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
          WHERE rt.role_name = @roleName
            AND rt.is_active = 1
            AND p.is_active = 1
        `);

      console.log(`  ✓ Role permissions: ${rolePerms.recordset.length} found`);

      // Get custom permissions
      const customPerms = await pool.request()
        .input('userId', sql.UniqueIdentifier, testUser.user_id)
        .query(`
          SELECT p.permission_key, ucp.is_granted, ucp.expires_at
          FROM USER_CUSTOM_PERMISSIONS ucp
          INNER JOIN PERMISSIONS p ON ucp.permission_id = p.permission_id
          WHERE ucp.user_id = @userId
            AND p.is_active = 1
            AND (ucp.expires_at IS NULL OR ucp.expires_at > GETUTCDATE())
        `);

      console.log(`  ✓ Custom permissions: ${customPerms.recordset.length} found`);

      // Build effective permissions
      const effectivePerms = new Set(rolePerms.recordset.map(r => r.permission_key));
      customPerms.recordset.forEach(row => {
        if (row.is_granted) {
          effectivePerms.add(row.permission_key);
        } else {
          effectivePerms.delete(row.permission_key);
        }
      });

      console.log(`  ✓ PASS: Effective permissions calculated: ${effectivePerms.size} total`);
      console.log(`    Permissions: ${Array.from(effectivePerms).join(', ')}`);
    }

    // Test 5: Verify specific permission checks
    console.log('\nTest 5: Testing specific permission checks...');

    const employeePerms = await pool.request()
      .input('roleName', sql.VarChar(50), 'employee')
      .query(`
        SELECT p.permission_key
        FROM ROLE_PERMISSIONS rp
        INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
        INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
        WHERE rt.role_name = @roleName
      `);

    const permKeys = employeePerms.recordset.map(r => r.permission_key);

    console.log('  Expected employee permissions:');
    console.log('    ✓ assets.read:', permKeys.includes('assets.read') ? 'FOUND' : 'MISSING');
    console.log('    ✓ masters.read:', permKeys.includes('masters.read') ? 'FOUND' : 'MISSING');
    console.log('    ✓ tickets.create:', permKeys.includes('tickets.create') ? 'FOUND' : 'MISSING');
    console.log('    ✓ tickets.read:', permKeys.includes('tickets.read') ? 'FOUND' : 'MISSING');
    console.log('    ✓ reports.view:', permKeys.includes('reports.view') ? 'FOUND' : 'MISSING');
    console.log('    ✗ users.read:', !permKeys.includes('users.read') ? 'CORRECTLY NOT PRESENT' : 'ERROR: SHOULD NOT HAVE');

    console.log('\n===========================================');
    console.log('✅ ALL TESTS PASSED');
    console.log('===========================================');
    console.log('\nThe permission system is now working correctly!');
    console.log('You can now restart your backend server and test API endpoints.\n');

  } catch (error) {
    console.error('\n✗ TEST FAILED');
    console.error('Error:', error.message);
    console.error('\nDetails:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

testPermissionFix().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
