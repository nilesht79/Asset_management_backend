/**
 * Migration Runner Script
 * Usage: node scripts/run-migration.js <migration-file.sql>
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

// Load environment variables
require('dotenv').config();

// Database configuration
const dbConfig = {
  server: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'asset_management',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Password123',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

async function runMigration(sqlFilePath) {
  let pool;

  try {
    // Read SQL file
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

    console.log(`\n📄 Running migration: ${path.basename(sqlFilePath)}`);
    console.log('=' .repeat(60));

    // Connect to database
    pool = await sql.connect(dbConfig);
    console.log('✓ Connected to database');

    // Split SQL file by GO statements and execute each batch
    const batches = sqlContent
      .split(/^\s*GO\s*$/mi)
      .map(batch => batch.trim())
      .filter(batch => batch.length > 0);

    console.log(`\n📦 Executing ${batches.length} SQL batches...\n`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      try {
        const result = await pool.request().query(batch);

        // Print any PRINT statements from SQL
        if (result.recordset && result.recordset.length > 0) {
          result.recordset.forEach(row => {
            if (row['']) {
              console.log(row['']);
            }
          });
        }

        // Handle info messages (PRINT statements)
        pool.on('infoMessage', info => {
          console.log(info.message);
        });

      } catch (batchError) {
        console.error(`\n✗ Error in batch ${i + 1}:`);
        console.error(batchError.message);
        throw batchError;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✓ Migration completed successfully!\n');

  } catch (error) {
    console.error('\n✗ Migration failed:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);

  } finally {
    if (pool) {
      await pool.close();
      console.log('✓ Database connection closed\n');
    }
  }
}

// Main execution
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('\n✗ Error: No migration file specified');
  console.error('\nUsage: node scripts/run-migration.js <migration-file.sql>');
  console.error('\nExample:');
  console.error('  node scripts/run-migration.js scripts/migrations/add-component-movement-types.sql\n');
  process.exit(1);
}

const fullPath = path.resolve(migrationFile);

if (!fs.existsSync(fullPath)) {
  console.error(`\n✗ Error: Migration file not found: ${fullPath}\n`);
  process.exit(1);
}

runMigration(fullPath);
