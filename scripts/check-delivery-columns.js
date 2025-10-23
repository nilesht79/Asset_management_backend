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

async function checkColumns() {
  try {
    console.log('🔌 Connecting to database...');
    await sql.connect(config);
    console.log('✅ Connected to database\n');

    const result = await sql.query`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'ASSET_DELIVERY_TICKETS'
      AND COLUMN_NAME IN (
        'signed_form_upload_path',
        'signed_form_uploaded_by',
        'signed_form_uploaded_at',
        'coordinator_verified',
        'coordinator_verified_by',
        'coordinator_verified_at',
        'coordinator_verification_notes',
        'functionality_confirmed',
        'functionality_confirmed_at',
        'functionality_notes'
      )
      ORDER BY ORDINAL_POSITION
    `;

    console.log('📊 Delivery Verification Workflow Columns:');
    console.log('==========================================\n');

    if (result.recordset.length === 0) {
      console.log('❌ No columns found - migration needs to be run!\n');
    } else {
      result.recordset.forEach(col => {
        const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
        const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
        console.log(`✅ ${col.COLUMN_NAME.padEnd(35)} ${col.DATA_TYPE}${length.padEnd(10)} ${nullable}`);
      });
      console.log(`\n✅ Found ${result.recordset.length}/10 expected columns\n`);
    }

    await sql.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkColumns();
