require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function checkProductsTable() {
  try {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'products'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('PRODUCTS table columns:');
    console.log('='.repeat(60));
    result.recordset.forEach(col => {
      const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
      console.log(`${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE}${length} ${nullable}`);
    });

    // Check foreign keys
    console.log('\n\nFOREIGN KEY CONSTRAINTS:');
    console.log('='.repeat(60));
    const fkResult = await pool.request().query(`
      SELECT
        fk.name AS constraint_name,
        OBJECT_NAME(fk.parent_object_id) AS table_name,
        COL_NAME(fc.parent_object_id, fc.parent_column_id) AS column_name,
        OBJECT_NAME(fk.referenced_object_id) AS referenced_table,
        COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS referenced_column
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fc ON fk.object_id = fc.constraint_object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = 'products'
    `);

    if (fkResult.recordset.length === 0) {
      console.log('No foreign keys found');
    } else {
      fkResult.recordset.forEach(fk => {
        console.log(`${fk.column_name} -> ${fk.referenced_table}(${fk.referenced_column})`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkProductsTable();
