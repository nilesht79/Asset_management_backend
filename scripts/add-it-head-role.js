const { connectDB, sql } = require('../src/config/database');

async function addITHeadRole() {
  try {
    const pool = await connectDB();
    console.log('Adding IT Head role to ROLE_TEMPLATES...\n');

    // Check if IT Head role already exists
    const checkResult = await pool.request()
      .query("SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = 'it_head'");

    if (checkResult.recordset.length > 0) {
      console.log('ℹ️  IT Head role already exists');
      process.exit(0);
    }

    // Insert IT Head role
    const insertResult = await pool.request()
      .query(`
        INSERT INTO ROLE_TEMPLATES (role_name, display_name, description, hierarchy_level, is_system_role, is_active, created_at, updated_at)
        OUTPUT INSERTED.role_template_id, INSERTED.role_name
        VALUES ('it_head', 'IT Head', 'IT Head - Approves IT requisitions and manages technology assets', 80, 1, 1, GETUTCDATE(), GETUTCDATE())
      `);

    const newRole = insertResult.recordset[0];
    console.log(`✅ Created IT Head role with ID: ${newRole.role_template_id}`);

    // Verify the role was created
    const verifyResult = await pool.request()
      .query('SELECT role_name FROM ROLE_TEMPLATES ORDER BY role_name');

    console.log('\n📋 All roles in database:');
    verifyResult.recordset.forEach(r => {
      console.log(`  - ${r.role_name}`);
    });

    console.log('\n✅ IT Head role added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error adding IT Head role:', error);
    process.exit(1);
  }
}

addITHeadRole();
