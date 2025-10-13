const { connectDB, sql } = require('../src/config/database');

async function testFieldTemplates() {
  try {
    const pool = await connectDB();

    // Test 1: Get all templates with their product types
    console.log('=== TEST 1: Fetch all field templates ===\n');
    const templates = await pool.request().query(`
      SELECT
        t.id,
        t.field_name,
        t.display_label,
        t.field_type,
        t.is_required,
        t.display_order,
        pt.name as product_type
      FROM component_field_templates t
      JOIN product_types pt ON t.product_type_id = pt.id
      WHERE t.is_active = 1
      ORDER BY pt.name, t.display_order
    `);

    console.log(`Found ${templates.recordset.length} field templates\n`);

    // Group by product type
    const byType = {};
    templates.recordset.forEach(t => {
      if (!byType[t.product_type]) byType[t.product_type] = [];
      byType[t.product_type].push(t);
    });

    Object.keys(byType).forEach(type => {
      console.log(`📦 ${type}:`);
      byType[type].forEach(field => {
        const req = field.is_required ? '✓ Required' : '  Optional';
        console.log(`  ${field.display_order}. ${field.display_label.padEnd(20)} (${field.field_type.padEnd(20)}) ${req}`);
      });
      console.log('');
    });

    // Test 2: Get RAM template with options
    console.log('\n=== TEST 2: Fetch RAM/Memory template with options ===\n');
    const ramType = await pool.request().query(`
      SELECT id FROM product_types WHERE name = 'RAM/Memory'
    `);

    if (ramType.recordset.length > 0) {
      const ramTemplates = await pool.request()
        .input('typeId', sql.UniqueIdentifier, ramType.recordset[0].id)
        .query(`
          SELECT
            t.id,
            t.field_name,
            t.display_label,
            t.field_type,
            t.is_required,
            t.placeholder_text,
            t.help_text
          FROM component_field_templates t
          WHERE t.product_type_id = @typeId AND t.is_active = 1
          ORDER BY t.display_order
        `);

      console.log(`RAM/Memory has ${ramTemplates.recordset.length} fields:\n`);

      for (const field of ramTemplates.recordset) {
        console.log(`📌 ${field.display_label}:`);
        console.log(`   Field Name: ${field.field_name}`);
        console.log(`   Type: ${field.field_type}`);
        console.log(`   Required: ${field.is_required ? 'Yes' : 'No'}`);
        console.log(`   Placeholder: ${field.placeholder_text || 'N/A'}`);

        // Get options for this field
        const options = await pool.request()
          .input('fieldId', sql.UniqueIdentifier, field.id)
          .query(`
            SELECT option_value, option_label, is_default, display_order
            FROM component_field_options
            WHERE field_template_id = @fieldId
            ORDER BY display_order
          `);

        if (options.recordset.length > 0) {
          console.log(`   Options:`);
          options.recordset.forEach(opt => {
            const def = opt.is_default ? '★ ' : '  ';
            console.log(`     ${def}${opt.option_label} (${opt.option_value})`);
          });
        }
        console.log('');
      }
    }

    // Test 3: Count statistics
    console.log('\n=== TEST 3: Statistics ===\n');
    const stats = await pool.request().query(`
      SELECT
        COUNT(DISTINCT t.product_type_id) as type_count,
        COUNT(DISTINCT t.id) as field_count,
        COUNT(o.id) as option_count
      FROM component_field_templates t
      LEFT JOIN component_field_options o ON t.id = o.field_template_id
      WHERE t.is_active = 1
    `);

    const s = stats.recordset[0];
    console.log(`✓ Product Types Configured: ${s.type_count}`);
    console.log(`✓ Total Fields: ${s.field_count}`);
    console.log(`✓ Total Options: ${s.option_count}`);

    // Test 4: Test a complete template query (what frontend will use)
    console.log('\n=== TEST 4: Complete Template Query (Frontend View) ===\n');
    const cpuType = await pool.request().query(`
      SELECT id FROM product_types WHERE name = 'Processor/CPU'
    `);

    if (cpuType.recordset.length > 0) {
      const completeTemplate = await pool.request()
        .input('typeId', sql.UniqueIdentifier, cpuType.recordset[0].id)
        .query(`
          SELECT
            t.id as field_id,
            t.field_name,
            t.display_label,
            t.field_type,
            t.is_required,
            t.display_order,
            t.placeholder_text,
            t.help_text,
            o.id as option_id,
            o.option_value,
            o.option_label,
            o.is_default,
            o.display_order as option_order
          FROM component_field_templates t
          LEFT JOIN component_field_options o ON t.id = o.field_template_id
          WHERE t.product_type_id = @typeId AND t.is_active = 1
          ORDER BY t.display_order, o.display_order
        `);

      console.log(`Processor/CPU Template (as frontend will receive it):\n`);
      console.log(JSON.stringify(completeTemplate.recordset, null, 2));
    }

    console.log('\n=== ✅ ALL TESTS PASSED ===\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testFieldTemplates();
