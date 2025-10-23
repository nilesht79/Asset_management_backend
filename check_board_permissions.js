const { connectDB, sql } = require('./src/config/database');

async function checkBoardPermissions() {
  try {
    const pool = await connectDB();
    
    // Check if boards permissions exist
    console.log('\n=== Board Permissions ===');
    const boardPermsResult = await pool.request().query(`
      SELECT permission_key, permission_name, description, is_active
      FROM PERMISSION_MASTER
      WHERE permission_key LIKE 'boards%'
      ORDER BY permission_key
    `);
    
    if (boardPermsResult.recordset.length === 0) {
      console.log('❌ No board permissions found in database!');
    } else {
      console.log('✅ Found board permissions:');
      boardPermsResult.recordset.forEach(p => {
        console.log(`  - ${p.permission_key}: ${p.permission_name} (Active: ${p.is_active})`);
      });
    }
    
    // Check Department Head role permissions
    console.log('\n=== Department Head Permissions ===');
    const deptHeadResult = await pool.request().query(`
      SELECT 
        r.role_name,
        p.permission_key,
        p.permission_name
      FROM ROLE_MASTER r
      INNER JOIN ROLE_PERMISSIONS rp ON r.role_id = rp.role_id
      INNER JOIN PERMISSION_MASTER p ON rp.permission_id = p.permission_id
      WHERE r.role_name = 'department_head'
        AND p.permission_key LIKE 'boards%'
      ORDER BY p.permission_key
    `);
    
    if (deptHeadResult.recordset.length === 0) {
      console.log('❌ Department Head does NOT have board permissions!');
    } else {
      console.log('✅ Department Head has these board permissions:');
      deptHeadResult.recordset.forEach(p => {
        console.log(`  - ${p.permission_key}: ${p.permission_name}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBoardPermissions();
