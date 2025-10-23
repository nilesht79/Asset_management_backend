/**
 * Check USER_MASTER table column names
 */

const sql = require('mssql');

// Database configuration
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

async function checkUserColumns() {
  let pool;

  try {
    console.log('\n🔍 Checking USER_MASTER table structure...\n');

    pool = await sql.connect(dbConfig);
    console.log('✓ Connected to database\n');

    // Get column information
    const result = await pool.request().query(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'USER_MASTER'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('📊 USER_MASTER Table Columns:');
    console.log('='.repeat(80));
    result.recordset.forEach(col => {
      console.log(`  ${col.COLUMN_NAME.padEnd(30)} | ${col.DATA_TYPE.padEnd(15)} | Nullable: ${col.IS_NULLABLE}`);
    });
    console.log('='.repeat(80));

    // Get a sample user to see actual data
    const sampleUser = await pool.request().query(`
      SELECT TOP 1 * FROM USER_MASTER
    `);

    if (sampleUser.recordset.length > 0) {
      console.log('\n📝 Sample User Data:');
      console.log('='.repeat(80));
      console.log(JSON.stringify(sampleUser.recordset[0], null, 2));
      console.log('='.repeat(80));
    }

    // Check specific user with the UUID from error
    const specificUser = await pool.request()
      .input('userId', sql.UniqueIdentifier, 'B55C0B39-A9AF-4630-A009-FA4FD19B4D59')
      .query(`SELECT * FROM USER_MASTER WHERE user_id = @userId`);

    if (specificUser.recordset.length > 0) {
      console.log('\n👤 User B55C0B39-A9AF-4630-A009-FA4FD19B4D59:');
      console.log('='.repeat(80));
      console.log(JSON.stringify(specificUser.recordset[0], null, 2));
      console.log('='.repeat(80));
    } else {
      console.log('\n⚠️  User B55C0B39-A9AF-4630-A009-FA4FD19B4D59 not found in database!');
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

checkUserColumns();
