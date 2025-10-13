const { connectDB, sql } = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

async function seedComponentTypes() {
  try {
    const pool = await connectDB();

    console.log('Seeding component types and categories...\n');

    // Component types to create
    const componentTypes = [
      { name: 'RAM/Memory', description: 'Random Access Memory modules' },
      { name: 'Processor/CPU', description: 'Central Processing Units' },
      { name: 'Storage - HDD', description: 'Hard Disk Drives' },
      { name: 'Storage - SSD/NVMe', description: 'Solid State Drives and NVMe drives' },
      { name: 'Graphics Card/GPU', description: 'Graphics Processing Units' },
      { name: 'Motherboard', description: 'Motherboards and system boards' },
      { name: 'Power Supply', description: 'Power Supply Units (PSU)' },
      { name: 'Network Card', description: 'Network Interface Cards (NIC)' },
      { name: 'Complete System', description: 'Complete computers (Laptops, Desktops, Servers)' }
    ];

    console.log('Step 1: Creating product types...\n');

    for (const type of componentTypes) {
      const typeId = uuidv4();

      // Check if type already exists
      const existing = await pool.request()
        .input('name', sql.VarChar(100), type.name)
        .query('SELECT id FROM product_types WHERE name = @name');

      if (existing.recordset.length === 0) {
        await pool.request()
          .input('id', sql.UniqueIdentifier, typeId)
          .input('name', sql.VarChar(100), type.name)
          .input('description', sql.VarChar(500), type.description)
          .input('isActive', sql.Bit, true)
          .query(`
            INSERT INTO product_types (id, name, description, is_active, created_at, updated_at)
            VALUES (@id, @name, @description, @isActive, GETUTCDATE(), GETUTCDATE())
          `);
        console.log(`✓ Created: ${type.name}`);
      } else {
        console.log(`- Skipped (exists): ${type.name}`);
      }
    }

    console.log('\nStep 2: Creating categories for component types...\n');

    // Get the type IDs we just created
    const types = await pool.request().query('SELECT id, name FROM product_types');
    const typeMap = {};
    types.recordset.forEach(t => {
      typeMap[t.name] = t.id;
    });

    // Categories for each component type
    const categories = [
      // RAM categories
      { name: 'DDR3 Memory', type: 'RAM/Memory', description: 'DDR3 RAM modules' },
      { name: 'DDR4 Memory', type: 'RAM/Memory', description: 'DDR4 RAM modules' },
      { name: 'DDR5 Memory', type: 'RAM/Memory', description: 'DDR5 RAM modules' },

      // CPU categories
      { name: 'Desktop Processor', type: 'Processor/CPU', description: 'Desktop CPUs' },
      { name: 'Server Processor', type: 'Processor/CPU', description: 'Server-grade CPUs' },
      { name: 'Mobile Processor', type: 'Processor/CPU', description: 'Laptop/Mobile CPUs' },

      // HDD categories
      { name: 'HDD 3.5"', type: 'Storage - HDD', description: '3.5 inch hard drives' },
      { name: 'HDD 2.5"', type: 'Storage - HDD', description: '2.5 inch hard drives' },

      // SSD/NVMe categories
      { name: 'SSD SATA', type: 'Storage - SSD/NVMe', description: 'SATA Solid State Drives' },
      { name: 'SSD NVMe', type: 'Storage - SSD/NVMe', description: 'NVMe Solid State Drives' },
      { name: 'SSD M.2', type: 'Storage - SSD/NVMe', description: 'M.2 form factor SSDs' },

      // GPU categories
      { name: 'Desktop Graphics Card', type: 'Graphics Card/GPU', description: 'Desktop GPUs' },
      { name: 'Workstation Graphics Card', type: 'Graphics Card/GPU', description: 'Professional GPUs' },

      // Motherboard categories
      { name: 'ATX Motherboard', type: 'Motherboard', description: 'ATX form factor motherboards' },
      { name: 'Micro-ATX Motherboard', type: 'Motherboard', description: 'Micro-ATX motherboards' },
      { name: 'Mini-ITX Motherboard', type: 'Motherboard', description: 'Mini-ITX motherboards' },

      // PSU categories
      { name: 'ATX Power Supply', type: 'Power Supply', description: 'ATX power supplies' },
      { name: 'Modular Power Supply', type: 'Power Supply', description: 'Modular PSUs' },

      // Network Card categories
      { name: 'Ethernet Card', type: 'Network Card', description: 'Ethernet NICs' },
      { name: 'WiFi Card', type: 'Network Card', description: 'Wireless network cards' },

      // Complete System categories
      { name: 'Desktop Computer', type: 'Complete System', description: 'Desktop computers' },
      { name: 'Laptop Computer', type: 'Complete System', description: 'Laptop computers' },
      { name: 'Server', type: 'Complete System', description: 'Server systems' }
    ];

    for (const cat of categories) {
      const catId = uuidv4();

      // Check if category already exists
      const existing = await pool.request()
        .input('name', sql.VarChar(100), cat.name)
        .query('SELECT id FROM categories WHERE name = @name');

      if (existing.recordset.length === 0) {
        await pool.request()
          .input('id', sql.UniqueIdentifier, catId)
          .input('name', sql.VarChar(100), cat.name)
          .input('description', sql.VarChar(500), cat.description)
          .input('isActive', sql.Bit, true)
          .query(`
            INSERT INTO categories (id, name, description, is_active, created_at, updated_at)
            VALUES (@id, @name, @description, @isActive, GETUTCDATE(), GETUTCDATE())
          `);
        console.log(`✓ Created category: ${cat.name} (${cat.type})`);
      } else {
        console.log(`- Skipped (exists): ${cat.name}`);
      }
    }

    console.log('\n==========================================');
    console.log('✓ Successfully seeded component types and categories');
    console.log('==========================================\n');

    // Summary
    const typeCount = await pool.request().query('SELECT COUNT(*) as count FROM product_types');
    const catCount = await pool.request().query('SELECT COUNT(*) as count FROM categories');

    console.log('Summary:');
    console.log(`- Product Types: ${typeCount.recordset[0].count}`);
    console.log(`- Categories: ${catCount.recordset[0].count}\n`);

    console.log('You can now create products like:');
    console.log('- Type: RAM/Memory → Category: DDR4 Memory → Product: "Kingston 16GB DDR4 3200MHz"');
    console.log('- Type: Processor/CPU → Category: Desktop Processor → Product: "Intel Core i7-13700K"');
    console.log('- Type: Storage - SSD/NVMe → Category: SSD NVMe → Product: "Samsung 980 PRO 1TB"\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seedComponentTypes();
