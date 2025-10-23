/**
 * Check ASSETS table structure
 */

const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  server: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'asset_management',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Password123',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true
  }
};

async function checkAssetsTable() {
  let pool;

  try {
    console.log('\n🔍 Checking ASSETS table structure...\n');

    pool = await sql.connect(dbConfig);

    // Get column information
    const result = await pool.request().query(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'assets'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('📊 ASSETS Table Columns:');
    console.log('='.repeat(80));
    result.recordset.forEach(col => {
      console.log(`  ${col.COLUMN_NAME.padEnd(30)} | ${col.DATA_TYPE.padEnd(15)} | Nullable: ${col.IS_NULLABLE}`);
    });
    console.log('='.repeat(80));

    // Check current status values
    const statusValues = await pool.request().query(`
      SELECT DISTINCT status, COUNT(*) as count
      FROM assets
      WHERE is_active = 1
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('\n📊 Current Status Values:');
    console.log('='.repeat(80));
    statusValues.recordset.forEach(row => {
      console.log(`  ${row.status?.padEnd(20) || 'NULL'.padEnd(20)} | Count: ${row.count}`);
    });
    console.log('='.repeat(80));

    // Check CHECK constraints
    const constraints = await pool.request().query(`
      SELECT
        cc.name as constraint_name,
        cc.definition
      FROM sys.check_constraints cc
      INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
      WHERE t.name = 'assets'
    `);

    console.log('\n🔒 CHECK Constraints:');
    console.log('='.repeat(80));
    constraints.recordset.forEach(row => {
      console.log(`  ${row.constraint_name}:`);
      console.log(`    ${row.definition}`);
    });
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n✓ Database connection closed\n');
    }
  }
}

checkAssetsTable();
