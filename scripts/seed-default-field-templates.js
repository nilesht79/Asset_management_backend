const { connectDB, sql } = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

async function seedDefaultFieldTemplates() {
  try {
    const pool = await connectDB();

    console.log('Seeding default component field templates...\n');

    // Get all product types
    const types = await pool.request().query('SELECT id, name FROM product_types');
    const typeMap = {};
    types.recordset.forEach(t => {
      typeMap[t.name] = t.id;
    });

    // Define field templates for each component type
    const templates = [
      // RAM/Memory Templates
      {
        type: 'RAM/Memory',
        fields: [
          {
            field_name: 'capacity',
            display_label: 'Memory Size',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 1,
            placeholder_text: 'e.g., 16',
            help_text: 'Enter the memory capacity',
            options: [
              { value: 'GB', label: 'GB (Gigabytes)', is_default: true, order: 1 },
              { value: 'MB', label: 'MB (Megabytes)', is_default: false, order: 2 }
            ]
          },
          {
            field_name: 'speed',
            display_label: 'Frequency',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 2,
            placeholder_text: 'e.g., 3200',
            help_text: 'Memory frequency/speed',
            options: [
              { value: 'MHz', label: 'MHz (Megahertz)', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'interface_type',
            display_label: 'Memory Type',
            field_type: 'select',
            is_required: true,
            display_order: 3,
            placeholder_text: 'Select memory type',
            help_text: 'DDR generation',
            options: [
              { value: 'DDR3', label: 'DDR3', is_default: false, order: 1 },
              { value: 'DDR4', label: 'DDR4', is_default: true, order: 2 },
              { value: 'DDR5', label: 'DDR5', is_default: false, order: 3 }
            ]
          },
          {
            field_name: 'form_factor',
            display_label: 'Form Factor',
            field_type: 'select',
            is_required: false,
            display_order: 4,
            placeholder_text: 'Select form factor',
            help_text: 'Physical form factor',
            options: [
              { value: 'DIMM', label: 'DIMM (Desktop)', is_default: true, order: 1 },
              { value: 'SO-DIMM', label: 'SO-DIMM (Laptop)', is_default: false, order: 2 },
              { value: 'ECC', label: 'ECC (Server)', is_default: false, order: 3 }
            ]
          }
        ]
      },

      // Processor/CPU Templates
      {
        type: 'Processor/CPU',
        fields: [
          {
            field_name: 'capacity',
            display_label: 'Core Count',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 1,
            placeholder_text: 'e.g., 8',
            help_text: 'Number of processor cores',
            options: [
              { value: 'Cores', label: 'Cores', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'speed',
            display_label: 'Base Clock',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 2,
            placeholder_text: 'e.g., 3.6',
            help_text: 'Base clock frequency',
            options: [
              { value: 'GHz', label: 'GHz (Gigahertz)', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'interface_type',
            display_label: 'Socket Type',
            field_type: 'select',
            is_required: false,
            display_order: 3,
            placeholder_text: 'Select socket',
            help_text: 'CPU socket/interface',
            options: [
              { value: 'LGA1700', label: 'LGA1700 (Intel 12th/13th Gen)', is_default: false, order: 1 },
              { value: 'LGA1200', label: 'LGA1200 (Intel 10th/11th Gen)', is_default: false, order: 2 },
              { value: 'AM5', label: 'AM5 (AMD Ryzen 7000)', is_default: false, order: 3 },
              { value: 'AM4', label: 'AM4 (AMD Ryzen 5000)', is_default: false, order: 4 }
            ]
          }
        ]
      },

      // Storage - HDD Templates
      {
        type: 'Storage - HDD',
        fields: [
          {
            field_name: 'capacity',
            display_label: 'Storage Capacity',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 1,
            placeholder_text: 'e.g., 1000',
            help_text: 'Storage capacity',
            options: [
              { value: 'GB', label: 'GB (Gigabytes)', is_default: false, order: 1 },
              { value: 'TB', label: 'TB (Terabytes)', is_default: true, order: 2 }
            ]
          },
          {
            field_name: 'speed',
            display_label: 'Spindle Speed',
            field_type: 'number_with_unit',
            is_required: false,
            display_order: 2,
            placeholder_text: 'e.g., 7200',
            help_text: 'Drive rotation speed',
            options: [
              { value: 'RPM', label: 'RPM (Revolutions per minute)', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'interface_type',
            display_label: 'Interface',
            field_type: 'select',
            is_required: false,
            display_order: 3,
            placeholder_text: 'Select interface',
            help_text: 'Connection interface',
            options: [
              { value: 'SATA', label: 'SATA', is_default: true, order: 1 },
              { value: 'SAS', label: 'SAS', is_default: false, order: 2 }
            ]
          },
          {
            field_name: 'form_factor',
            display_label: 'Form Factor',
            field_type: 'select',
            is_required: false,
            display_order: 4,
            placeholder_text: 'Select form factor',
            help_text: 'Physical size',
            options: [
              { value: '3.5"', label: '3.5" (Desktop)', is_default: true, order: 1 },
              { value: '2.5"', label: '2.5" (Laptop)', is_default: false, order: 2 }
            ]
          }
        ]
      },

      // Storage - SSD/NVMe Templates
      {
        type: 'Storage - SSD/NVMe',
        fields: [
          {
            field_name: 'capacity',
            display_label: 'Storage Capacity',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 1,
            placeholder_text: 'e.g., 1024',
            help_text: 'Storage capacity',
            options: [
              { value: 'GB', label: 'GB (Gigabytes)', is_default: true, order: 1 },
              { value: 'TB', label: 'TB (Terabytes)', is_default: false, order: 2 }
            ]
          },
          {
            field_name: 'speed',
            display_label: 'Read Speed',
            field_type: 'number_with_unit',
            is_required: false,
            display_order: 2,
            placeholder_text: 'e.g., 7000',
            help_text: 'Sequential read speed',
            options: [
              { value: 'MB/s', label: 'MB/s (Megabytes per second)', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'interface_type',
            display_label: 'Interface',
            field_type: 'select',
            is_required: false,
            display_order: 3,
            placeholder_text: 'Select interface',
            help_text: 'Connection interface',
            options: [
              { value: 'NVMe', label: 'NVMe (PCIe)', is_default: true, order: 1 },
              { value: 'SATA', label: 'SATA', is_default: false, order: 2 }
            ]
          },
          {
            field_name: 'form_factor',
            display_label: 'Form Factor',
            field_type: 'select',
            is_required: false,
            display_order: 4,
            placeholder_text: 'Select form factor',
            help_text: 'Physical form factor',
            options: [
              { value: 'M.2', label: 'M.2', is_default: true, order: 1 },
              { value: '2.5"', label: '2.5"', is_default: false, order: 2 }
            ]
          }
        ]
      },

      // Graphics Card/GPU Templates
      {
        type: 'Graphics Card/GPU',
        fields: [
          {
            field_name: 'capacity',
            display_label: 'VRAM Size',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 1,
            placeholder_text: 'e.g., 8',
            help_text: 'Video memory size',
            options: [
              { value: 'GB', label: 'GB (Gigabytes)', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'speed',
            display_label: 'Clock Speed',
            field_type: 'number_with_unit',
            is_required: false,
            display_order: 2,
            placeholder_text: 'e.g., 1800',
            help_text: 'GPU core clock speed',
            options: [
              { value: 'MHz', label: 'MHz (Megahertz)', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'interface_type',
            display_label: 'Interface',
            field_type: 'select',
            is_required: false,
            display_order: 3,
            placeholder_text: 'Select interface',
            help_text: 'Connection interface',
            options: [
              { value: 'PCIe 4.0', label: 'PCIe 4.0 x16', is_default: true, order: 1 },
              { value: 'PCIe 3.0', label: 'PCIe 3.0 x16', is_default: false, order: 2 }
            ]
          }
        ]
      },

      // Motherboard Templates
      {
        type: 'Motherboard',
        fields: [
          {
            field_name: 'interface_type',
            display_label: 'Chipset',
            field_type: 'text',
            is_required: false,
            display_order: 1,
            placeholder_text: 'e.g., Z790, B660, X670',
            help_text: 'Motherboard chipset'
          },
          {
            field_name: 'form_factor',
            display_label: 'Form Factor',
            field_type: 'select',
            is_required: false,
            display_order: 2,
            placeholder_text: 'Select form factor',
            help_text: 'Board size',
            options: [
              { value: 'ATX', label: 'ATX', is_default: true, order: 1 },
              { value: 'Micro-ATX', label: 'Micro-ATX', is_default: false, order: 2 },
              { value: 'Mini-ITX', label: 'Mini-ITX', is_default: false, order: 3 }
            ]
          }
        ]
      },

      // Power Supply Templates
      {
        type: 'Power Supply',
        fields: [
          {
            field_name: 'capacity',
            display_label: 'Wattage',
            field_type: 'number_with_unit',
            is_required: true,
            display_order: 1,
            placeholder_text: 'e.g., 750',
            help_text: 'Power output',
            options: [
              { value: 'W', label: 'Watts', is_default: true, order: 1 }
            ]
          },
          {
            field_name: 'form_factor',
            display_label: 'Form Factor',
            field_type: 'select',
            is_required: false,
            display_order: 2,
            placeholder_text: 'Select form factor',
            help_text: 'PSU form factor',
            options: [
              { value: 'ATX', label: 'ATX', is_default: true, order: 1 },
              { value: 'SFX', label: 'SFX', is_default: false, order: 2 }
            ]
          }
        ]
      }
    ];

    let totalFields = 0;
    let totalOptions = 0;

    for (const template of templates) {
      const typeId = typeMap[template.type];
      if (!typeId) {
        console.log(`⚠ Skipping ${template.type} - type not found`);
        continue;
      }

      console.log(`\nSeeding template for: ${template.type}`);

      for (const field of template.fields) {
        const fieldId = uuidv4();

        // Insert field template
        await pool.request()
          .input('id', sql.UniqueIdentifier, fieldId)
          .input('productTypeId', sql.UniqueIdentifier, typeId)
          .input('fieldName', sql.VarChar(50), field.field_name)
          .input('displayLabel', sql.VarChar(100), field.display_label)
          .input('fieldType', sql.VarChar(50), field.field_type)
          .input('isRequired', sql.Bit, field.is_required)
          .input('displayOrder', sql.Int, field.display_order)
          .input('placeholderText', sql.VarChar(200), field.placeholder_text)
          .input('helpText', sql.VarChar(500), field.help_text)
          .query(`
            INSERT INTO component_field_templates (
              id, product_type_id, field_name, display_label, field_type,
              is_required, display_order, placeholder_text, help_text
            )
            VALUES (
              @id, @productTypeId, @fieldName, @displayLabel, @fieldType,
              @isRequired, @displayOrder, @placeholderText, @helpText
            )
          `);

        totalFields++;
        console.log(`  ✓ ${field.display_label} (${field.field_type})`);

        // Insert field options if any
        if (field.options && field.options.length > 0) {
          for (const option of field.options) {
            await pool.request()
              .input('fieldTemplateId', sql.UniqueIdentifier, fieldId)
              .input('optionValue', sql.VarChar(100), option.value)
              .input('optionLabel', sql.VarChar(100), option.label)
              .input('isDefault', sql.Bit, option.is_default)
              .input('displayOrder', sql.Int, option.order)
              .query(`
                INSERT INTO component_field_options (
                  field_template_id, option_value, option_label, is_default, display_order
                )
                VALUES (
                  @fieldTemplateId, @optionValue, @optionLabel, @isDefault, @displayOrder
                )
              `);

            totalOptions++;
          }
          console.log(`    → ${field.options.length} options added`);
        }
      }
    }

    console.log('\n==========================================');
    console.log('✓ Successfully seeded default field templates');
    console.log('==========================================');
    console.log(`Total Fields: ${totalFields}`);
    console.log(`Total Options: ${totalOptions}\n`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seedDefaultFieldTemplates();
