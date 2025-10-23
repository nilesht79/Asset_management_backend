/**
 * Check recent asset movements
 */

const sql = require('mssql');

const dbConfig = {
  server: 'localhost',
  database: 'asset_management',
  user: 'sa',
  password: 'YourStrong@Password123',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

async function checkMovements() {
  let pool;

  try {
    console.log('\n🔍 Checking recent asset movements...\n');

    pool = await sql.connect(dbConfig);

    // Get recent component movements
    const result = await pool.request().query(`
      SELECT TOP 10
        id,
        asset_tag,
        movement_type,
        status,
        location_name,
        previous_location_name,
        performed_by,
        performed_by_name,
        movement_date,
        created_at
      FROM ASSET_MOVEMENTS
      WHERE movement_type IN ('component_install', 'component_remove')
      ORDER BY created_at DESC
    `);

    console.log(`📊 Found ${result.recordset.length} component movements:\n`);
    console.log('='.repeat(120));

    result.recordset.forEach((movement, index) => {
      console.log(`\n${index + 1}. Movement ID: ${movement.id}`);
      console.log(`   Asset Tag: ${movement.asset_tag}`);
      console.log(`   Type: ${movement.movement_type}`);
      console.log(`   Status: ${movement.status}`);
      console.log(`   From: ${movement.previous_location_name || 'N/A'}`);
      console.log(`   To: ${movement.location_name || 'N/A'}`);
      console.log(`   Performed By: ${movement.performed_by}`);
      console.log(`   Performed By Name: "${movement.performed_by_name}"`);
      console.log(`   Date: ${movement.movement_date}`);
    });

    console.log('\n' + '='.repeat(120));

    // Check all movements with "undefined undefined"
    const undefinedResult = await pool.request().query(`
      SELECT
        id,
        asset_tag,
        movement_type,
        performed_by,
        performed_by_name,
        created_at
      FROM ASSET_MOVEMENTS
      WHERE performed_by_name LIKE '%undefined%'
      ORDER BY created_at DESC
    `);

    if (undefinedResult.recordset.length > 0) {
      console.log(`\n⚠️  Found ${undefinedResult.recordset.length} movements with "undefined" in performed_by_name:\n`);
      undefinedResult.recordset.forEach((movement, index) => {
        console.log(`${index + 1}. ${movement.asset_tag} | ${movement.movement_type} | "${movement.performed_by_name}" | ${movement.created_at}`);
      });
    } else {
      console.log('\n✓ No movements with "undefined" in performed_by_name');
    }

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error(error.stack);
    process.exit(1);

  } finally {
    if (pool) {
      await pool.close();
      console.log('\n✓ Database connection closed\n');
    }
  }
}

checkMovements();
