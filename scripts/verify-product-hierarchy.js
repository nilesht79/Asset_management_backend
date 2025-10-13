require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function verifyProductHierarchy() {
  try {
    console.log('🔍 Verifying Product Hierarchy Structure...\n');
    console.log('Expected Hierarchy:');
    console.log('OEM → Category → SubCategory → Type → Series → Product\n');
    console.log('='.repeat(80));

    const pool = await connectDB();

    // Check 1: OEM_MASTER (oems table)
    console.log('\n1️⃣  OEM MASTER (oems table)');
    const oemsResult = await pool.request().query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM oems
    `);
    console.log(`   ✅ Table exists: oems`);
    console.log(`   📊 Total OEMs: ${oemsResult.recordset[0].total_count}`);
    console.log(`   ✓  Active: ${oemsResult.recordset[0].active_count}`);

    // Check 2: PRODUCT_CATEGORY_MASTER (categories table - parent_category_id IS NULL)
    console.log('\n2️⃣  PRODUCT CATEGORY MASTER (categories - top level)');
    const categoriesResult = await pool.request().query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM categories
      WHERE parent_category_id IS NULL
    `);
    console.log(`   ✅ Table exists: categories`);
    console.log(`   📊 Total Categories: ${categoriesResult.recordset[0].total_count}`);
    console.log(`   ✓  Active: ${categoriesResult.recordset[0].active_count}`);

    // Check 3: PRODUCT_SUBCATEGORY_MASTER (categories table - parent_category_id IS NOT NULL)
    console.log('\n3️⃣  PRODUCT SUBCATEGORY MASTER (categories - child level)');
    const subcategoriesResult = await pool.request().query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM categories
      WHERE parent_category_id IS NOT NULL
    `);
    console.log(`   ✅ Table exists: categories (with parent_category_id)`);
    console.log(`   📊 Total SubCategories: ${subcategoriesResult.recordset[0].total_count}`);
    console.log(`   ✓  Active: ${subcategoriesResult.recordset[0].active_count}`);

    // Check 4: PRODUCT_TYPE_MASTER (product_types table)
    console.log('\n4️⃣  PRODUCT TYPE MASTER (product_types table)');
    const typesResult = await pool.request().query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM product_types
    `);
    console.log(`   ✅ Table exists: product_types`);
    console.log(`   📊 Total Types: ${typesResult.recordset[0].total_count}`);
    console.log(`   ✓  Active: ${typesResult.recordset[0].active_count}`);

    // Check 5: PRODUCT_SERIES_MASTER (product_series table)
    console.log('\n5️⃣  PRODUCT SERIES MASTER (product_series table)');
    const seriesResult = await pool.request().query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM product_series
    `);
    console.log(`   ✅ Table exists: product_series`);
    console.log(`   📊 Total Series: ${seriesResult.recordset[0].total_count}`);
    console.log(`   ✓  Active: ${seriesResult.recordset[0].active_count}`);

    // Check 6: PRODUCT_MASTER (products table)
    console.log('\n6️⃣  PRODUCT MASTER (products table)');
    const productsResult = await pool.request().query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM products
    `);
    console.log(`   ✅ Table exists: products`);
    console.log(`   📊 Total Products: ${productsResult.recordset[0].total_count}`);
    console.log(`   ✓  Active: ${productsResult.recordset[0].active_count}`);

    // Verify Foreign Key Relationships
    console.log('\n' + '='.repeat(80));
    console.log('🔗 VERIFYING FOREIGN KEY RELATIONSHIPS\n');

    // Check products table foreign keys
    console.log('📋 Products Table Foreign Keys:');
    const productFKs = await pool.request().query(`
      SELECT
        fk.name AS constraint_name,
        OBJECT_NAME(fk.parent_object_id) AS table_name,
        COL_NAME(fc.parent_object_id, fc.parent_column_id) AS column_name,
        OBJECT_NAME(fk.referenced_object_id) AS referenced_table,
        COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS referenced_column
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fc ON fk.object_id = fc.constraint_object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = 'products'
      ORDER BY column_name
    `);

    if (productFKs.recordset.length > 0) {
      productFKs.recordset.forEach(fk => {
        console.log(`   ✅ ${fk.column_name} → ${fk.referenced_table}(${fk.referenced_column})`);
      });
    } else {
      console.log('   ⚠️  No foreign keys found!');
    }

    // Check product_series table foreign keys
    console.log('\n📋 Product Series Table Foreign Keys:');
    const seriesFKs = await pool.request().query(`
      SELECT
        fk.name AS constraint_name,
        OBJECT_NAME(fk.parent_object_id) AS table_name,
        COL_NAME(fc.parent_object_id, fc.parent_column_id) AS column_name,
        OBJECT_NAME(fk.referenced_object_id) AS referenced_table,
        COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS referenced_column
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fc ON fk.object_id = fc.constraint_object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = 'product_series'
      ORDER BY column_name
    `);

    if (seriesFKs.recordset.length > 0) {
      seriesFKs.recordset.forEach(fk => {
        console.log(`   ✅ ${fk.column_name} → ${fk.referenced_table}(${fk.referenced_column})`);
      });
    } else {
      console.log('   ⚠️  No foreign keys found!');
    }

    // Sample data verification
    console.log('\n' + '='.repeat(80));
    console.log('📊 SAMPLE HIERARCHY DATA\n');

    const sampleData = await pool.request().query(`
      SELECT TOP 5
        p.name as product_name,
        p.model as product_model,
        o.name as oem,
        c.name as category,
        sc.name as subcategory,
        ps.name as series
      FROM products p
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories sc ON p.subcategory_id = sc.id
      LEFT JOIN product_series ps ON p.series_id = ps.id
      WHERE p.is_active = 1
    `);

    if (sampleData.recordset.length > 0) {
      sampleData.recordset.forEach((row, idx) => {
        console.log(`\nExample ${idx + 1}:`);
        console.log(`  Product: ${row.product_name} (${row.product_model || 'N/A'})`);
        console.log(`  OEM: ${row.oem || '❌ MISSING'}`);
        console.log(`  Category: ${row.category || '❌ MISSING'}`);
        console.log(`  SubCategory: ${row.subcategory || '⚠️  Not set'}`);
        console.log(`  Series: ${row.series || '⚠️  Not set'}`);
      });
    } else {
      console.log('  ℹ️  No active products found');
    }

    // Check for orphaned records
    console.log('\n' + '='.repeat(80));
    console.log('🔍 CHECKING FOR DATA INTEGRITY ISSUES\n');

    const orphanedProducts = await pool.request().query(`
      SELECT COUNT(*) as count
      FROM products p
      WHERE p.oem_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM oems o WHERE o.id = p.oem_id)
    `);

    if (orphanedProducts.recordset[0].count > 0) {
      console.log(`   ❌ ${orphanedProducts.recordset[0].count} products have invalid OEM references`);
    } else {
      console.log(`   ✅ All products have valid OEM references`);
    }

    const orphanedCategories = await pool.request().query(`
      SELECT COUNT(*) as count
      FROM products p
      WHERE p.category_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id)
    `);

    if (orphanedCategories.recordset[0].count > 0) {
      console.log(`   ❌ ${orphanedCategories.recordset[0].count} products have invalid category references`);
    } else {
      console.log(`   ✅ All products have valid category references`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Verification Complete!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error verifying product hierarchy:', error.message);
    console.error(error);
    process.exit(1);
  }
}

verifyProductHierarchy();
