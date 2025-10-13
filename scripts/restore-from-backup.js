require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: 'master', // Connect to master to restore
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
    requestTimeout: 300000, // 5 minutes
    connectionTimeout: 30000
  }
};

async function restoreDatabase() {
  let pool;
  try {
    console.log('🔄 Starting database restore from backup...\n');

    const backupPath = '/var/opt/mssql/data/asset_management.bak';
    const dbName = process.env.DB_NAME;

    pool = await sql.connect(dbConfig);
    console.log('✅ Connected to SQL Server\n');

    // Get logical file names from backup
    console.log('🔍 Reading backup file information...');
    const fileListResult = await pool.request().query(`
      RESTORE FILELISTONLY FROM DISK = '${backupPath}'
    `);

    if (!fileListResult.recordset || fileListResult.recordset.length === 0) {
      throw new Error('Could not read backup file or backup file is invalid');
    }

    const dataFile = fileListResult.recordset.find(f => f.Type === 'D');
    const logFile = fileListResult.recordset.find(f => f.Type === 'L');

    if (!dataFile || !logFile) {
      console.error('❌ Could not identify data and log files in backup');
      console.log('\nBackup contents:');
      console.log(fileListResult.recordset);
      process.exit(1);
    }

    console.log(`   Data file: ${dataFile.LogicalName}`);
    console.log(`   Log file: ${logFile.LogicalName}\n`);

    // Kill all connections to the target database
    console.log('🔒 Closing existing database connections...');
    try {
      await pool.request().query(`
        USE master;
        IF EXISTS (SELECT name FROM sys.databases WHERE name = '${dbName}')
        BEGIN
          ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        END
      `);
      console.log('   ✅ Database set to single-user mode\n');
    } catch (error) {
      console.log('   ⚠️  Database may not exist yet\n');
    }

    // Restore database
    console.log('📥 Restoring database (this may take a few minutes)...');

    const restoreQuery = `
      RESTORE DATABASE [${dbName}]
      FROM DISK = '${backupPath}'
      WITH REPLACE,
      MOVE '${dataFile.LogicalName}' TO '/var/opt/mssql/data/${dbName}.mdf',
      MOVE '${logFile.LogicalName}' TO '/var/opt/mssql/data/${dbName}_log.ldf',
      STATS = 10
    `;

    await pool.request().query(restoreQuery);
    console.log('   ✅ Database restored successfully\n');

    // Set database back to multi-user mode
    console.log('🔓 Setting database to multi-user mode...');
    await pool.request().query(`
      ALTER DATABASE [${dbName}] SET MULTI_USER
    `);
    console.log('   ✅ Database is now accessible\n');

    // Connect to the restored database and show tables
    await pool.close();

    const restoredDbConfig = { ...dbConfig, database: dbName };
    pool = await sql.connect(restoredDbConfig);

    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    console.log('✅ Database restored successfully!\n');
    console.log(`📋 Restored ${tablesResult.recordset.length} table(s):`);
    tablesResult.recordset.forEach(table => {
      console.log(`   • ${table.TABLE_NAME}`);
    });

    await pool.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error restoring database:', error.message);
    if (error.precedingErrors) {
      console.error('Additional errors:', error.precedingErrors);
    }
    if (pool) {
      await pool.close();
    }
    process.exit(1);
  }
}

restoreDatabase();
