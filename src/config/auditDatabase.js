/**
 * AUDIT DATABASE CONFIGURATION
 * Separate database connection for audit logs
 * This ensures audit logs are isolated from the main application database
 */

const sql = require('mssql');
require('dotenv').config();

// Audit database configuration - uses same server but different database
const auditDbConfig = {
  user: process.env.AUDIT_DB_USER || process.env.DB_USER,
  password: process.env.AUDIT_DB_PASSWORD || process.env.DB_PASSWORD,
  server: process.env.AUDIT_DB_HOST || process.env.DB_HOST,
  port: parseInt(process.env.AUDIT_DB_PORT || process.env.DB_PORT) || 1433,
  database: process.env.AUDIT_DB_NAME || 'audit_logs',
  options: {
    encrypt: process.env.AUDIT_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.AUDIT_DB_TRUST_SERVER_CERTIFICATE === 'true' || process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
    requestTimeout: 30000,
    connectionTimeout: 30000
  },
  pool: {
    max: 10,  // Smaller pool for audit DB
    min: 2,
    idleTimeoutMillis: 30000
  }
};

let auditPool = null;

/**
 * Connect to the audit database
 * Uses a separate ConnectionPool to avoid conflicts with main database
 * @returns {Promise<sql.ConnectionPool>} Database connection pool
 */
const connectAuditDB = async () => {
  try {
    if (auditPool && auditPool.connected) {
      return auditPool;
    }

    // Create a new separate connection pool for audit database
    // Using new ConnectionPool() instead of sql.connect() to avoid global pool conflicts
    auditPool = new sql.ConnectionPool(auditDbConfig);
    await auditPool.connect();
    console.log('✅ Connected to Audit Database:', auditDbConfig.database);
    return auditPool;
  } catch (error) {
    console.error('❌ Audit Database connection failed:', error.message);
    auditPool = null;
    // Don't throw - audit DB failure shouldn't crash the main app
    return null;
  }
};

/**
 * Close the audit database connection
 */
const closeAuditDB = async () => {
  try {
    if (auditPool) {
      await auditPool.close();
      auditPool = null;
      console.log('Audit Database connection closed');
    }
  } catch (error) {
    console.error('Error closing audit database connection:', error.message);
  }
};

/**
 * Get the audit database pool
 * @returns {sql.ConnectionPool|null} Database pool or null if not connected
 */
const getAuditPool = () => {
  return auditPool;
};

/**
 * Check if audit database is connected
 * @returns {boolean} True if connected
 */
const isAuditDBConnected = () => {
  return auditPool !== null && auditPool.connected;
};

/**
 * Execute a query on the audit database with retry logic
 * @param {Function} queryFn - Function that takes pool and returns query result
 * @param {number} retries - Number of retries (default 2)
 * @returns {Promise<any>} Query result or null on failure
 */
const executeAuditQuery = async (queryFn, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let pool = auditPool;

      // Try to reconnect if not connected
      if (!pool || !pool.connected) {
        pool = await connectAuditDB();
      }

      if (!pool) {
        console.warn('Audit database not available, skipping audit log');
        return null;
      }

      return await queryFn(pool);
    } catch (error) {
      console.error(`Audit query attempt ${attempt + 1} failed:`, error.message);

      if (attempt === retries) {
        console.error('All audit query attempts failed');
        return null;
      }

      // Reset pool on error
      auditPool = null;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return null;
};

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  await closeAuditDB();
});

process.on('SIGTERM', async () => {
  await closeAuditDB();
});

module.exports = {
  connectAuditDB,
  closeAuditDB,
  getAuditPool,
  isAuditDBConnected,
  executeAuditQuery,
  auditDbConfig,
  sql
};
