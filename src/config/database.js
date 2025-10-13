const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
    requestTimeout: 30000,
    connectionTimeout: 30000
  },
  pool: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000
  }
};

let pool = null;

const connectDB = async () => {
  try {
    if (pool) {
      return pool;
    }
    
    pool = await sql.connect(dbConfig);
    console.log('✅ Connected to SQL Server database');
    return pool;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

const closeDB = async () => {
  try {
    if (pool) {
      await pool.close();
      pool = null;
      console.log('Database connection closed');
    }
  } catch (error) {
    console.error('Error closing database connection:', error.message);
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return pool;
};

process.on('SIGINT', async () => {
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDB();
  process.exit(0);
});

module.exports = {
  connectDB,
  closeDB,
  getPool,
  sql
};