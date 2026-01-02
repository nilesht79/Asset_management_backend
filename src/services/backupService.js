/**
 * BACKUP SERVICE
 * Handles database backups, restoration, and disaster recovery operations
 */

const { connectDB, sql } = require('../config/database');
const { backupConfig } = require('../config/backup');
const fs = require('fs').promises;
const path = require('path');
const { auditService } = require('./auditService');

class BackupService {
  constructor() {
    this.backupHistory = [];
  }

  /**
   * Generate backup filename
   * @param {string} dbName - Database name
   * @param {string} type - Backup type (full, diff, log)
   * @returns {string} Backup filename
   */
  generateBackupFilename(dbName, type) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const typePrefix = {
      full: 'FULL',
      differential: 'DIFF',
      transactionLog: 'LOG'
    };
    return `${dbName}_${typePrefix[type] || type.toUpperCase()}_${timestamp}.bak`;
  }

  /**
   * Ensure backup directory exists
   * @param {string} dirPath - Directory path
   */
  async ensureBackupDirectory(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Perform full database backup
   * @param {string} dbName - Database name
   * @returns {Promise<Object>} Backup result
   */
  async performFullBackup(dbName) {
    const startTime = Date.now();
    const filename = this.generateBackupFilename(dbName, 'full');
    const backupPath = path.join(backupConfig.sqlServer.backupDirectory, filename);

    try {
      console.log(`[Backup] Starting full backup for ${dbName}...`);

      const pool = await connectDB();

      // Build backup command
      let backupCommand = `
        BACKUP DATABASE [${dbName}]
        TO DISK = '${backupPath}'
        WITH FORMAT,
        NAME = '${dbName} Full Backup',
        DESCRIPTION = 'Full backup of ${dbName} created by automated backup service'
      `;

      // Add compression if enabled
      if (backupConfig.compression.enabled) {
        backupCommand += `, COMPRESSION`;
      }

      // Add checksum for verification
      if (backupConfig.verification.enabled) {
        backupCommand += `, CHECKSUM`;
      }

      await pool.request().query(backupCommand);

      // Get backup file info
      const verifyResult = await this.verifyBackup(dbName, backupPath);

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        database: dbName,
        type: 'full',
        filename,
        path: backupPath,
        size: verifyResult.backupSize,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        verified: verifyResult.valid
      };

      // Log to history
      await this.logBackupHistory(result);

      console.log(`[Backup] Full backup completed for ${dbName} in ${duration}ms`);

      return result;
    } catch (error) {
      console.error(`[Backup] Full backup failed for ${dbName}:`, error.message);

      const result = {
        success: false,
        database: dbName,
        type: 'full',
        filename,
        error: error.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      await this.logBackupHistory(result);
      throw error;
    }
  }

  /**
   * Perform differential backup
   * @param {string} dbName - Database name
   * @returns {Promise<Object>} Backup result
   */
  async performDifferentialBackup(dbName) {
    const startTime = Date.now();
    const filename = this.generateBackupFilename(dbName, 'differential');
    const backupPath = path.join(backupConfig.sqlServer.backupDirectory, filename);

    try {
      console.log(`[Backup] Starting differential backup for ${dbName}...`);

      const pool = await connectDB();

      let backupCommand = `
        BACKUP DATABASE [${dbName}]
        TO DISK = '${backupPath}'
        WITH DIFFERENTIAL,
        NAME = '${dbName} Differential Backup',
        DESCRIPTION = 'Differential backup of ${dbName}'
      `;

      if (backupConfig.compression.enabled) {
        backupCommand += `, COMPRESSION`;
      }

      if (backupConfig.verification.enabled) {
        backupCommand += `, CHECKSUM`;
      }

      await pool.request().query(backupCommand);

      const verifyResult = await this.verifyBackup(dbName, backupPath);

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        database: dbName,
        type: 'differential',
        filename,
        path: backupPath,
        size: verifyResult.backupSize,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        verified: verifyResult.valid
      };

      await this.logBackupHistory(result);

      console.log(`[Backup] Differential backup completed for ${dbName} in ${duration}ms`);

      return result;
    } catch (error) {
      console.error(`[Backup] Differential backup failed for ${dbName}:`, error.message);

      const result = {
        success: false,
        database: dbName,
        type: 'differential',
        filename,
        error: error.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      await this.logBackupHistory(result);
      throw error;
    }
  }

  /**
   * Perform transaction log backup
   * @param {string} dbName - Database name
   * @returns {Promise<Object>} Backup result
   */
  async performTransactionLogBackup(dbName) {
    const startTime = Date.now();
    const filename = this.generateBackupFilename(dbName, 'transactionLog');
    const backupPath = path.join(backupConfig.sqlServer.backupDirectory, filename);

    try {
      console.log(`[Backup] Starting transaction log backup for ${dbName}...`);

      const pool = await connectDB();

      // Check if database is in FULL recovery model
      const recoveryCheck = await pool.request().query(`
        SELECT recovery_model_desc
        FROM sys.databases
        WHERE name = '${dbName}'
      `);

      if (recoveryCheck.recordset[0]?.recovery_model_desc !== 'FULL') {
        console.log(`[Backup] Skipping log backup for ${dbName} - not in FULL recovery model`);
        return {
          success: true,
          database: dbName,
          type: 'transactionLog',
          skipped: true,
          reason: 'Database not in FULL recovery model',
          timestamp: new Date().toISOString()
        };
      }

      let backupCommand = `
        BACKUP LOG [${dbName}]
        TO DISK = '${backupPath}'
        WITH NAME = '${dbName} Transaction Log Backup',
        DESCRIPTION = 'Transaction log backup of ${dbName}'
      `;

      if (backupConfig.compression.enabled) {
        backupCommand += `, COMPRESSION`;
      }

      await pool.request().query(backupCommand);

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        database: dbName,
        type: 'transactionLog',
        filename,
        path: backupPath,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };

      await this.logBackupHistory(result);

      console.log(`[Backup] Transaction log backup completed for ${dbName} in ${duration}ms`);

      return result;
    } catch (error) {
      console.error(`[Backup] Transaction log backup failed for ${dbName}:`, error.message);

      const result = {
        success: false,
        database: dbName,
        type: 'transactionLog',
        filename,
        error: error.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      await this.logBackupHistory(result);
      throw error;
    }
  }

  /**
   * Verify backup integrity
   * @param {string} dbName - Database name
   * @param {string} backupPath - Path to backup file
   * @returns {Promise<Object>} Verification result
   */
  async verifyBackup(dbName, backupPath) {
    try {
      const pool = await connectDB();

      // Verify backup using RESTORE VERIFYONLY
      await pool.request().query(`
        RESTORE VERIFYONLY
        FROM DISK = '${backupPath}'
        WITH CHECKSUM
      `);

      // Get backup file header info
      const headerInfo = await pool.request().query(`
        RESTORE HEADERONLY
        FROM DISK = '${backupPath}'
      `);

      const backupInfo = headerInfo.recordset[0];

      return {
        valid: true,
        backupSize: backupInfo?.BackupSize || 0,
        compressedSize: backupInfo?.CompressedBackupSize || 0,
        backupStartDate: backupInfo?.BackupStartDate,
        backupFinishDate: backupInfo?.BackupFinishDate
      };
    } catch (error) {
      console.error(`[Backup] Verification failed:`, error.message);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Run all scheduled backups for all databases
   * @param {string} type - Backup type (full, differential, transactionLog)
   * @returns {Promise<Object>} Results summary
   */
  async runScheduledBackups(type) {
    const results = {
      type,
      timestamp: new Date().toISOString(),
      databases: [],
      success: true,
      totalDuration: 0
    };

    const startTime = Date.now();

    for (const db of backupConfig.databases) {
      try {
        let result;
        switch (type) {
          case 'full':
            result = await this.performFullBackup(db.name);
            break;
          case 'differential':
            result = await this.performDifferentialBackup(db.name);
            break;
          case 'transactionLog':
            result = await this.performTransactionLogBackup(db.name);
            break;
          default:
            throw new Error(`Unknown backup type: ${type}`);
        }
        results.databases.push(result);
      } catch (error) {
        results.success = false;
        results.databases.push({
          database: db.name,
          type,
          success: false,
          error: error.message
        });
      }
    }

    results.totalDuration = Date.now() - startTime;

    // Send notification if configured
    if (backupConfig.notifications.enabled) {
      await this.sendNotification(results);
    }

    // Log to audit
    auditService.logJobExecution('database_backup', results.success ? 'completed' : 'failed', {
      type,
      databases: results.databases.map(d => d.database),
      duration_ms: results.totalDuration
    });

    return results;
  }

  /**
   * Cleanup old backups based on retention policy
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupOldBackups() {
    const results = {
      timestamp: new Date().toISOString(),
      deleted: [],
      errors: []
    };

    try {
      const pool = await connectDB();

      // Get list of backup files from msdb
      const backupHistory = await pool.request().query(`
        SELECT
          bs.database_name,
          bs.backup_start_date,
          bs.backup_finish_date,
          bs.type AS backup_type,
          bmf.physical_device_name
        FROM msdb.dbo.backupset bs
        INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
        WHERE bs.backup_start_date < DATEADD(DAY, -${backupConfig.retention.local.full}, GETUTCDATE())
        AND bs.database_name IN (${backupConfig.databases.map(d => `'${d.name}'`).join(',')})
        ORDER BY bs.backup_start_date
      `);

      for (const backup of backupHistory.recordset) {
        try {
          // Delete physical file
          await fs.unlink(backup.physical_device_name);
          results.deleted.push({
            database: backup.database_name,
            file: backup.physical_device_name,
            date: backup.backup_start_date
          });
        } catch (error) {
          if (error.code !== 'ENOENT') {
            results.errors.push({
              file: backup.physical_device_name,
              error: error.message
            });
          }
        }
      }

      // Clean up backup history in msdb (optional - keeps metadata clean)
      await pool.request().query(`
        EXEC msdb.dbo.sp_delete_backuphistory
        @oldest_date = '${new Date(Date.now() - backupConfig.retention.local.full * 24 * 60 * 60 * 1000).toISOString()}'
      `);

      console.log(`[Backup] Cleanup completed: ${results.deleted.length} files deleted`);
    } catch (error) {
      console.error('[Backup] Cleanup failed:', error.message);
      results.errors.push({ error: error.message });
    }

    return results;
  }

  /**
   * Get backup history
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Backup history
   */
  async getBackupHistory(filters = {}) {
    try {
      const pool = await connectDB();

      let query = `
        SELECT TOP 100
          bs.database_name,
          bs.backup_start_date,
          bs.backup_finish_date,
          CASE bs.type
            WHEN 'D' THEN 'Full'
            WHEN 'I' THEN 'Differential'
            WHEN 'L' THEN 'Transaction Log'
            ELSE bs.type
          END AS backup_type,
          bs.backup_size,
          bs.compressed_backup_size,
          bmf.physical_device_name,
          bs.is_damaged,
          DATEDIFF(SECOND, bs.backup_start_date, bs.backup_finish_date) AS duration_seconds
        FROM msdb.dbo.backupset bs
        INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
        WHERE 1=1
      `;

      if (filters.database) {
        query += ` AND bs.database_name = '${filters.database}'`;
      }

      if (filters.type) {
        const typeMap = { full: 'D', differential: 'I', transactionLog: 'L' };
        query += ` AND bs.type = '${typeMap[filters.type] || filters.type}'`;
      }

      if (filters.startDate) {
        query += ` AND bs.backup_start_date >= '${filters.startDate}'`;
      }

      query += ` ORDER BY bs.backup_start_date DESC`;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('[Backup] Failed to get history:', error.message);
      return [];
    }
  }

  /**
   * Get backup status summary
   * @returns {Promise<Object>} Status summary
   */
  async getBackupStatus() {
    try {
      const pool = await connectDB();

      const status = {
        databases: [],
        lastFullBackup: null,
        lastDiffBackup: null,
        lastLogBackup: null,
        totalBackupSize: 0,
        healthStatus: 'healthy'
      };

      for (const db of backupConfig.databases) {
        const dbStatus = await pool.request().query(`
          SELECT
            database_name,
            MAX(CASE WHEN type = 'D' THEN backup_finish_date END) AS last_full_backup,
            MAX(CASE WHEN type = 'I' THEN backup_finish_date END) AS last_diff_backup,
            MAX(CASE WHEN type = 'L' THEN backup_finish_date END) AS last_log_backup,
            SUM(backup_size) AS total_size
          FROM msdb.dbo.backupset
          WHERE database_name = '${db.name}'
          AND backup_start_date > DATEADD(DAY, -30, GETUTCDATE())
          GROUP BY database_name
        `);

        if (dbStatus.recordset.length > 0) {
          const record = dbStatus.recordset[0];
          status.databases.push({
            name: db.name,
            lastFullBackup: record.last_full_backup,
            lastDiffBackup: record.last_diff_backup,
            lastLogBackup: record.last_log_backup,
            totalSize: record.total_size
          });

          // Check health - warn if no full backup in last 2 days
          if (!record.last_full_backup ||
              new Date(record.last_full_backup) < new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)) {
            status.healthStatus = 'warning';
          }
        } else {
          status.databases.push({
            name: db.name,
            lastFullBackup: null,
            warning: 'No recent backups found'
          });
          status.healthStatus = 'critical';
        }
      }

      return status;
    } catch (error) {
      console.error('[Backup] Failed to get status:', error.message);
      return {
        error: error.message,
        healthStatus: 'error'
      };
    }
  }

  /**
   * Restore database from backup (for disaster recovery)
   * @param {string} dbName - Database name
   * @param {string} backupPath - Path to backup file
   * @param {Object} options - Restore options
   * @returns {Promise<Object>} Restore result
   */
  async restoreDatabase(dbName, backupPath, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`[Backup] Starting restore for ${dbName} from ${backupPath}...`);

      const pool = await connectDB();

      // Set database to single user mode for restore
      await pool.request().query(`
        ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE
      `);

      let restoreCommand = `
        RESTORE DATABASE [${dbName}]
        FROM DISK = '${backupPath}'
        WITH REPLACE
      `;

      if (options.noRecovery) {
        restoreCommand += `, NORECOVERY`;
      }

      if (options.stats) {
        restoreCommand += `, STATS = ${options.stats}`;
      }

      await pool.request().query(restoreCommand);

      // Set database back to multi-user
      await pool.request().query(`
        ALTER DATABASE [${dbName}] SET MULTI_USER
      `);

      const duration = Date.now() - startTime;

      console.log(`[Backup] Restore completed for ${dbName} in ${duration}ms`);

      return {
        success: true,
        database: dbName,
        backupPath,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`[Backup] Restore failed for ${dbName}:`, error.message);

      // Try to set database back to multi-user
      try {
        const pool = await connectDB();
        await pool.request().query(`ALTER DATABASE [${dbName}] SET MULTI_USER`);
      } catch (e) {
        // Ignore
      }

      return {
        success: false,
        database: dbName,
        error: error.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Log backup to history table
   * @param {Object} backupResult - Backup result
   */
  async logBackupHistory(backupResult) {
    try {
      const pool = await connectDB();

      await pool.request()
        .input('database_name', sql.NVarChar(100), backupResult.database)
        .input('backup_type', sql.NVarChar(20), backupResult.type)
        .input('filename', sql.NVarChar(500), backupResult.filename)
        .input('file_path', sql.NVarChar(1000), backupResult.path)
        .input('file_size', sql.BigInt, backupResult.size || 0)
        .input('duration_ms', sql.Int, backupResult.duration_ms)
        .input('status', sql.NVarChar(20), backupResult.success ? 'success' : 'failed')
        .input('error_message', sql.NVarChar(sql.MAX), backupResult.error || null)
        .input('verified', sql.Bit, backupResult.verified ? 1 : 0)
        .query(`
          INSERT INTO BACKUP_HISTORY (
            database_name, backup_type, filename, file_path, file_size,
            duration_ms, status, error_message, verified
          )
          VALUES (
            @database_name, @backup_type, @filename, @file_path, @file_size,
            @duration_ms, @status, @error_message, @verified
          )
        `);
    } catch (error) {
      // Don't throw - just log
      console.error('[Backup] Failed to log backup history:', error.message);
    }
  }

  /**
   * Send backup notification
   * @param {Object} results - Backup results
   */
  async sendNotification(results) {
    // Skip if notifications disabled
    if (!backupConfig.notifications.enabled) return;

    // Skip success notifications if not configured
    if (results.success && !backupConfig.notifications.email.onSuccess) return;

    // Skip if no recipients
    if (backupConfig.notifications.email.recipients.length === 0) return;

    try {
      const emailService = require('./emailService');

      const subject = results.success
        ? `[Backup Success] Database backup completed`
        : `[Backup FAILED] Database backup failed - Action Required`;

      const body = `
Database Backup Report
======================
Type: ${results.type}
Time: ${results.timestamp}
Status: ${results.success ? 'SUCCESS' : 'FAILED'}
Duration: ${results.totalDuration}ms

Database Results:
${results.databases.map(db => `
- ${db.database}: ${db.success ? 'OK' : 'FAILED'}
  ${db.error ? `Error: ${db.error}` : `File: ${db.filename}`}
  ${db.size ? `Size: ${(db.size / 1024 / 1024).toFixed(2)} MB` : ''}
`).join('')}

${!results.success ? '\n** IMMEDIATE ACTION REQUIRED **\nPlease investigate the backup failure and take corrective action.' : ''}
      `.trim();

      await emailService.sendEmail({
        to: backupConfig.notifications.email.recipients,
        subject,
        text: body
      });
    } catch (error) {
      console.error('[Backup] Failed to send notification:', error.message);
    }
  }
}

module.exports = new BackupService();
