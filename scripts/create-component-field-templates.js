const { connectDB, sql } = require('../src/config/database');

async function createComponentFieldTemplates() {
  try {
    const pool = await connectDB();

    console.log('Creating component field template tables...\n');

    // Step 1: Create component_field_templates table
    console.log('Step 1: Creating component_field_templates table...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='component_field_templates' AND xtype='U')
      CREATE TABLE component_field_templates (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        product_type_id UNIQUEIDENTIFIER NOT NULL,
        field_name VARCHAR(50) NOT NULL,
        display_label VARCHAR(100) NOT NULL,
        field_type VARCHAR(50) NOT NULL,
        is_required BIT DEFAULT 0,
        is_active BIT DEFAULT 1,
        display_order INT DEFAULT 0,
        placeholder_text VARCHAR(200) NULL,
        help_text VARCHAR(500) NULL,
        min_value DECIMAL(10,2) NULL,
        max_value DECIMAL(10,2) NULL,
        created_at DATETIME DEFAULT GETUTCDATE(),
        updated_at DATETIME DEFAULT GETUTCDATE(),
        CONSTRAINT FK_component_field_templates_product_type
          FOREIGN KEY (product_type_id) REFERENCES product_types(id) ON DELETE CASCADE
      )
    `);
    console.log('✓ component_field_templates table created\n');

    // Step 2: Create component_field_options table
    console.log('Step 2: Creating component_field_options table...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='component_field_options' AND xtype='U')
      CREATE TABLE component_field_options (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        field_template_id UNIQUEIDENTIFIER NOT NULL,
        option_value VARCHAR(100) NOT NULL,
        option_label VARCHAR(100) NOT NULL,
        is_default BIT DEFAULT 0,
        display_order INT DEFAULT 0,
        created_at DATETIME DEFAULT GETUTCDATE(),
        CONSTRAINT FK_component_field_options_template
          FOREIGN KEY (field_template_id) REFERENCES component_field_templates(id) ON DELETE CASCADE
      )
    `);
    console.log('✓ component_field_options table created\n');

    // Step 3: Create indexes for better performance
    console.log('Step 3: Creating indexes...');

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_component_field_templates_type_id')
      CREATE INDEX IDX_component_field_templates_type_id
      ON component_field_templates(product_type_id, is_active)
    `);
    console.log('✓ Index on product_type_id created');

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_component_field_options_template_id')
      CREATE INDEX IDX_component_field_options_template_id
      ON component_field_options(field_template_id)
    `);
    console.log('✓ Index on field_template_id created\n');

    // Step 4: Add unique constraint
    console.log('Step 4: Adding unique constraints...');
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.indexes
        WHERE name = 'UQ_component_field_templates_type_field'
      )
      CREATE UNIQUE INDEX UQ_component_field_templates_type_field
      ON component_field_templates(product_type_id, field_name)
      WHERE is_active = 1
    `);
    console.log('✓ Unique constraint added\n');

    // Step 5: Verify tables
    console.log('Step 5: Verifying tables...');
    const templateCols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'component_field_templates'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\ncomponent_field_templates columns:');
    templateCols.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME.padEnd(25)} (${col.DATA_TYPE})`);
    });

    const optionCols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'component_field_options'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\ncomponent_field_options columns:');
    optionCols.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME.padEnd(25)} (${col.DATA_TYPE})`);
    });

    console.log('\n==========================================');
    console.log('✓ Successfully created component field template tables');
    console.log('==========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createComponentFieldTemplates();
