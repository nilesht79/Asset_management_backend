const sql = require('mssql');

const config = {
  user: 'sa',
  password: 'YourStrong@Password123',
  server: 'localhost',
  database: 'asset_management',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  port: 1433
};

async function checkSchema() {
  try {
    console.log('🔌 Connecting to database...');
    await sql.connect(config);
    console.log('✅ Connected to database\n');

    const result = await sql.query`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'ASSET_DELIVERY_TICKETS'
      ORDER BY ORDINAL_POSITION
    `;

    console.log('📊 ASSET_DELIVERY_TICKETS Table Schema:');
    console.log('==========================================\n');

    result.recordset.forEach(col => {
      const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
      console.log(`${col.COLUMN_NAME.padEnd(40)} ${col.DATA_TYPE}${length.padEnd(15)} ${nullable}`);
    });

    console.log(`\n✅ Total columns: ${result.recordset.length}\n`);

    // Check if assigned_engineer_id exists
    const engineerColumn = result.recordset.find(col =>
      col.COLUMN_NAME === 'assigned_engineer_id' ||
      col.COLUMN_NAME.toLowerCase().includes('engineer')
    );

    if (engineerColumn) {
      console.log('✅ Engineer column found:', engineerColumn.COLUMN_NAME);
    } else {
      console.log('❌ No assigned_engineer_id column found!');
      console.log('💡 Need to add this column to the table.');
    }

    await sql.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkSchema();
