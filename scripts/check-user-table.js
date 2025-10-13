require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function checkUserTable() {
  try {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'USER_MASTER'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('USER_MASTER table columns:');
    console.log('='.repeat(60));
    result.recordset.forEach(col => {
      const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
      console.log(`${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE}${length} ${nullable}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUserTable();
