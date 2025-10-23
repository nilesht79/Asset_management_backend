const { connectDB, sql } = require('./src/config/database');

async function testUserPermissions() {
  console.log('🔍 Testing User Permissions\n');

  try {
    const pool = await connectDB();

    // Get a sample admin/superadmin user
    const userResult = await pool.request().query(`
      SELECT TOP 1
        user_id,
        first_name,
        last_name,
        email,
        role
      FROM USER_MASTER
      WHERE role IN ('admin', 'superadmin')
      AND is_active = 1
    `);

    if (userResult.recordset.length === 0) {
      console.log('⚠️  No admin/superadmin users found');
      return;
    }

    const user = userResult.recordset[0];
    console.log('📋 Testing with user:');
    console.table([user]);

    // Get user's role permissions
    const permissionsResult = await pool.request()
      .input('role', sql.VarChar(50), user.role)
      .query(`
        SELECT p.permission_key, p.permission_name
        FROM ROLE_PERMISSIONS rp
        INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
        INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
        WHERE rt.role_name = @role
        AND p.permission_key LIKE 'boards.%'
        ORDER BY p.permission_key
      `);

    console.log(`\n📋 Board Permissions for ${user.role}:`);
    if (permissionsResult.recordset.length > 0) {
      console.table(permissionsResult.recordset);
    } else {
      console.log('❌ No board permissions found!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

testUserPermissions();
