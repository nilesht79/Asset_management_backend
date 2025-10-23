const { connectDB, sql } = require('./src/config/database');
const { v4: uuidv4 } = require('uuid');

async function assignBoardPermissions() {
  console.log('🔧 Assigning Board Permissions to Roles\n');

  try {
    const pool = await connectDB();

    // Get board permissions
    const permissionsResult = await pool.request().query(`
      SELECT permission_id, permission_key
      FROM PERMISSIONS
      WHERE permission_key LIKE 'boards.%'
    `);

    const boardPermissions = permissionsResult.recordset;
    console.log(`Found ${boardPermissions.length} board permissions`);

    // Get admin and superadmin role IDs
    const rolesResult = await pool.request().query(`
      SELECT role_template_id, role_name
      FROM ROLE_TEMPLATES
      WHERE role_name IN ('admin', 'superadmin')
    `);

    const roles = rolesResult.recordset;
    const roleNames = roles.map(r => r.role_name).join(', ');
    console.log(`Found ${roles.length} roles to update: ${roleNames}\n`);

    let assignedCount = 0;

    for (const role of roles) {
      console.log(`Assigning permissions to ${role.role_name}...`);

      for (const permission of boardPermissions) {
        // Check if already assigned
        const existingResult = await pool.request()
          .input('roleId', sql.UniqueIdentifier, role.role_template_id)
          .input('permId', sql.UniqueIdentifier, permission.permission_id)
          .query(`
            SELECT COUNT(*) as count
            FROM ROLE_PERMISSIONS
            WHERE role_template_id = @roleId AND permission_id = @permId
          `);

        if (existingResult.recordset[0].count === 0) {
          // Assign permission
          await pool.request()
            .input('rolePermId', sql.UniqueIdentifier, uuidv4())
            .input('roleId', sql.UniqueIdentifier, role.role_template_id)
            .input('permId', sql.UniqueIdentifier, permission.permission_id)
            .query(`
              INSERT INTO ROLE_PERMISSIONS (role_permission_id, role_template_id, permission_id)
              VALUES (@rolePermId, @roleId, @permId)
            `);

          console.log(`  ✅ Assigned ${permission.permission_key}`);
          assignedCount++;
        } else {
          console.log(`  ℹ️  Already has ${permission.permission_key}`);
        }
      }
    }

    console.log(`\n✅ Assignment complete! ${assignedCount} new permissions assigned.`);

    // Verify assignments
    console.log('\n📊 Final Permission Summary:');
    const summaryResult = await pool.request().query(`
      SELECT
        rt.role_name,
        COUNT(rp.permission_id) as board_permission_count
      FROM ROLE_TEMPLATES rt
      LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id
      LEFT JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
      WHERE p.permission_key LIKE 'boards.%'
      GROUP BY rt.role_name
      ORDER BY board_permission_count DESC, rt.role_name
    `);

    console.table(summaryResult.recordset);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

assignBoardPermissions();
