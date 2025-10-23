const { connectDB, sql } = require('./src/config/database');

async function checkBoardPermissions() {
  console.log('🔍 Checking Board Permissions Assignment\n');

  try {
    const pool = await connectDB();

    // 1. Get all board permissions
    console.log('1. Board Permissions:');
    const permissions = await pool.request().query(`
      SELECT permission_id, permission_key, permission_name, description
      FROM PERMISSIONS
      WHERE permission_key LIKE 'boards.%'
      ORDER BY permission_key
    `);
    console.table(permissions.recordset);

    // 2. Get all role templates
    console.log('\n2. Available Role Templates:');
    const roles = await pool.request().query(`
      SELECT role_template_id, role_name, description
      FROM ROLE_TEMPLATES
      WHERE is_active = 1
      ORDER BY role_name
    `);
    console.table(roles.recordset);

    // 3. Check which roles have board permissions
    console.log('\n3. Board Permissions by Role:');
    const rolePermissions = await pool.request().query(`
      SELECT 
        rt.role_name,
        p.permission_key,
        p.permission_name
      FROM ROLE_PERMISSIONS rp
      INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
      INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
      WHERE p.permission_key LIKE 'boards.%'
      ORDER BY rt.role_name, p.permission_key
    `);

    if (rolePermissions.recordset.length > 0) {
      console.table(rolePermissions.recordset);
    } else {
      console.log('⚠️  No roles currently have board permissions assigned!');
    }

    // 4. Show which roles DON'T have board permissions
    console.log('\n4. Roles WITHOUT Board Permissions:');
    const rolesWithoutBoardPerms = await pool.request().query(`
      SELECT DISTINCT rt.role_name
      FROM ROLE_TEMPLATES rt
      WHERE rt.is_active = 1
      AND rt.role_template_id NOT IN (
        SELECT DISTINCT rp.role_template_id
        FROM ROLE_PERMISSIONS rp
        INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
        WHERE p.permission_key LIKE 'boards.%'
      )
      ORDER BY rt.role_name
    `);
    console.table(rolesWithoutBoardPerms.recordset);

    console.log('\n✅ Check complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkBoardPermissions();
