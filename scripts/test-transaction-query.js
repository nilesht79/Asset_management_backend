/**
 * Test query within transaction context
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

async function testTransactionQuery() {
  let pool;

  try {
    console.log('\n🧪 Testing query within transaction...\n');

    pool = await sql.connect(dbConfig);
    const transaction = pool.transaction();
    await transaction.begin();

    console.log('✓ Transaction started\n');

    // Test query within transaction
    const performedBy = 'B55C0B39-A9AF-4630-A009-FA4FD19B4D59';

    const performerDetails = await transaction.request()
      .input('performerId', sql.UniqueIdentifier, performedBy)
      .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @performerId');

    console.log('📊 Query Result:');
    console.log('='.repeat(80));
    console.log('Recordset:', performerDetails.recordset);
    console.log('First record:', performerDetails.recordset[0]);

    if (performerDetails.recordset[0]) {
      const performer = performerDetails.recordset[0];
      console.log('first_name:', performer.first_name);
      console.log('last_name:', performer.last_name);

      const performerName = performer ? `${performer.first_name} ${performer.last_name}` : 'System';
      console.log('Final name:', performerName);
    }
    console.log('='.repeat(80));

    await transaction.commit();
    console.log('\n✓ Transaction committed\n');

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error(error.stack);
    process.exit(1);

  } finally {
    if (pool) {
      await pool.close();
      console.log('✓ Database connection closed\n');
    }
  }
}

testTransactionQuery();
