const { connectDB, sql } = require('../src/config/database');

async function addComponentFieldsToProducts() {
  try {
    const pool = await connectDB();

    console.log('Adding component tracking fields to products table...\n');

    // Step 1: Add type_id column
    console.log('Step 1: Adding type_id column...');
    await pool.request().query(`
      ALTER TABLE products
      ADD type_id UNIQUEIDENTIFIER NULL
    `);
    console.log('✓ type_id column added\n');

    // Step 2: Add structured specification columns
    console.log('Step 2: Adding structured specification columns...');

    await pool.request().query(`
      ALTER TABLE products
      ADD capacity_value DECIMAL(10, 2) NULL
    `);
    console.log('✓ capacity_value added');

    await pool.request().query(`
      ALTER TABLE products
      ADD capacity_unit VARCHAR(20) NULL
    `);
    console.log('✓ capacity_unit added');

    await pool.request().query(`
      ALTER TABLE products
      ADD speed_value DECIMAL(10, 2) NULL
    `);
    console.log('✓ speed_value added');

    await pool.request().query(`
      ALTER TABLE products
      ADD speed_unit VARCHAR(20) NULL
    `);
    console.log('✓ speed_unit added');

    await pool.request().query(`
      ALTER TABLE products
      ADD interface_type VARCHAR(50) NULL
    `);
    console.log('✓ interface_type added');

    await pool.request().query(`
      ALTER TABLE products
      ADD form_factor VARCHAR(50) NULL
    `);
    console.log('✓ form_factor added\n');

    // Step 3: Add foreign key constraint for type_id
    console.log('Step 3: Adding foreign key constraint...');
    await pool.request().query(`
      ALTER TABLE products
      ADD CONSTRAINT FK_products_type_id
      FOREIGN KEY (type_id) REFERENCES product_types(id)
    `);
    console.log('✓ Foreign key constraint added\n');

    // Step 4: Create indexes for better performance
    console.log('Step 4: Creating indexes...');

    await pool.request().query(`
      CREATE INDEX IDX_products_type_id ON products(type_id)
    `);
    console.log('✓ Index on type_id created');

    await pool.request().query(`
      CREATE INDEX IDX_products_capacity ON products(capacity_value, capacity_unit)
    `);
    console.log('✓ Index on capacity created');

    await pool.request().query(`
      CREATE INDEX IDX_products_interface ON products(interface_type)
    `);
    console.log('✓ Index on interface_type created\n');

    // Step 5: Verify the changes
    console.log('Step 5: Verifying changes...');
    const result = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'products'
      AND COLUMN_NAME IN ('type_id', 'capacity_value', 'capacity_unit', 'speed_value', 'speed_unit', 'interface_type', 'form_factor')
      ORDER BY COLUMN_NAME
    `);

    console.log('\nNew columns added:');
    result.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME.padEnd(20)} (${col.DATA_TYPE})`);
    });

    console.log('\n==========================================');
    console.log('✓ Successfully added component tracking fields to products table');
    console.log('==========================================\n');

    console.log('Summary of changes:');
    console.log('- type_id: Links to product_types (RAM, CPU, Storage, etc.)');
    console.log('- capacity_value + capacity_unit: For RAM GB, Storage TB, CPU cores');
    console.log('- speed_value + speed_unit: For RAM MHz, CPU GHz, Storage MB/s');
    console.log('- interface_type: DDR4, DDR5, NVMe, SATA, PCIe, etc.');
    console.log('- form_factor: DIMM, SO-DIMM, M.2, 2.5", ATX, etc.\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

addComponentFieldsToProducts();
