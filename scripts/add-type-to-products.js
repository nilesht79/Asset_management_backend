const { connectDB, sql } = require('../src/config/database');

async function addTypeToProducts() {
  try {
    const pool = await connectDB();

    console.log('Adding type_id column to products table...\n');

    // Step 1: Add type_id column to products table
    console.log('Step 1: Adding type_id column...');
    await pool.request().query(`
      ALTER TABLE products
      ADD type_id UNIQUEIDENTIFIER NULL
    `);
    console.log('✓ type_id column added\n');

    // Step 2: Add foreign key constraint
    console.log('Step 2: Adding foreign key constraint...');
    await pool.request().query(`
      ALTER TABLE products
      ADD CONSTRAINT FK_products_type_id
      FOREIGN KEY (type_id) REFERENCES product_types(id)
    `);
    console.log('✓ Foreign key constraint added\n');

    // Step 3: Create index for better performance
    console.log('Step 3: Creating index on type_id...');
    await pool.request().query(`
      CREATE INDEX IDX_products_type_id ON products(type_id)
    `);
    console.log('✓ Index created\n');

    console.log('==========================================');
    console.log('✓ Successfully added type_id to products table');
    console.log('==========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

addTypeToProducts();
