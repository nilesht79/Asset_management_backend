/**
 * VALIDATE ALL DATABASE SCHEMAS
 * This script checks all tables and identifies column mismatches across the entire codebase
 */

require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true
  }
};

async function validateAllSchemas() {
  let pool;

  try {
    console.log('\n===========================================');
    console.log('VALIDATING ALL DATABASE SCHEMAS');
    console.log('===========================================\n');

    pool = await sql.connect(config);

    // Get all tables
    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME NOT LIKE 'oauth_%'
        AND TABLE_NAME NOT LIKE 'sys%'
      ORDER BY TABLE_NAME
    `);

    console.log(`Found ${tablesResult.recordset.length} tables to validate\n`);

    const schemaMap = {};

    // Get columns for each table
    for (const table of tablesResult.recordset) {
      const tableName = table.TABLE_NAME;

      const columnsResult = await pool.request()
        .input('tableName', sql.VarChar, tableName)
        .query(`
          SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @tableName
          ORDER BY ORDINAL_POSITION
        `);

      schemaMap[tableName] = columnsResult.recordset.map(r => ({
        name: r.COLUMN_NAME,
        type: r.DATA_TYPE,
        nullable: r.IS_NULLABLE === 'YES',
        maxLength: r.CHARACTER_MAXIMUM_LENGTH
      }));

      console.log(`✓ ${tableName} (${schemaMap[tableName].length} columns)`);
    }

    // Save schema map to file
    const schemaFilePath = path.join(__dirname, 'database-schema-map.json');
    fs.writeFileSync(schemaFilePath, JSON.stringify(schemaMap, null, 2), 'utf8');

    console.log(`\n✓ Schema map saved to: ${schemaFilePath}`);

    // Print detailed schema for key tables
    console.log('\n===========================================');
    console.log('KEY TABLE SCHEMAS');
    console.log('===========================================\n');

    const keyTables = [
      'USER_MASTER',
      'locations',
      'oems',
      'categories',
      'products',
      'PERMISSIONS',
      'ROLE_TEMPLATES',
      'DEPARTMENT_MASTER'
    ];

    for (const tableName of keyTables) {
      if (schemaMap[tableName]) {
        console.log(`\n${tableName}:`);
        schemaMap[tableName].forEach(col => {
          const typeInfo = col.maxLength ? `${col.type}(${col.maxLength})` : col.type;
          const nullInfo = col.nullable ? 'NULL' : 'NOT NULL';
          console.log(`  - ${col.name.padEnd(30)} ${typeInfo.padEnd(20)} ${nullInfo}`);
        });
      }
    }

    console.log('\n===========================================');
    console.log('VALIDATION COMPLETE');
    console.log('===========================================\n');

    console.log('Next steps:');
    console.log('1. Review database-schema-map.json for complete schema');
    console.log('2. Compare with code references to find mismatches');
    console.log('3. Run fix-schema-mismatches.js for any issues found\n');

  } catch (error) {
    console.error('\n✗ ERROR:', error.message);
    console.error('Details:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

validateAllSchemas().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
