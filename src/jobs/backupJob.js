/**
 * BACKUP JOB
 * Scheduled jobs for database backup operations
 */

const backupService = require('../services/backupService');

/**
 * Run full backup job
 * @returns {Promise<Object>} Backup results
 */
async function runFullBackupJob() {
  console.log('[BackupJob] Starting full backup job...');

  try {
    const result = await backupService.runScheduledBackups('full');

    if (result.success) {
      console.log(`[BackupJob] Full backup completed successfully in ${result.totalDuration}ms`);
    } else {
      console.error('[BackupJob] Full backup completed with errors');
    }

    return result;
  } catch (error) {
    console.error('[BackupJob] Full backup job failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Run differential backup job
 * @returns {Promise<Object>} Backup results
 */
async function runDifferentialBackupJob() {
  console.log('[BackupJob] Starting differential backup job...');

  try {
    const result = await backupService.runScheduledBackups('differential');

    if (result.success) {
      console.log(`[BackupJob] Differential backup completed successfully in ${result.totalDuration}ms`);
    } else {
      console.error('[BackupJob] Differential backup completed with errors');
    }

    return result;
  } catch (error) {
    console.error('[BackupJob] Differential backup job failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Run transaction log backup job
 * @returns {Promise<Object>} Backup results
 */
async function runTransactionLogBackupJob() {
  console.log('[BackupJob] Starting transaction log backup job...');

  try {
    const result = await backupService.runScheduledBackups('transactionLog');

    if (result.success) {
      console.log(`[BackupJob] Transaction log backup completed successfully in ${result.totalDuration}ms`);
    } else {
      console.error('[BackupJob] Transaction log backup completed with errors');
    }

    return result;
  } catch (error) {
    console.error('[BackupJob] Transaction log backup job failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Run backup cleanup job
 * @returns {Promise<Object>} Cleanup results
 */
async function runBackupCleanupJob() {
  console.log('[BackupJob] Starting backup cleanup job...');

  try {
    const result = await backupService.cleanupOldBackups();

    console.log(`[BackupJob] Cleanup completed: ${result.deleted.length} files deleted`);

    return result;
  } catch (error) {
    console.error('[BackupJob] Backup cleanup job failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  runFullBackupJob,
  runDifferentialBackupJob,
  runTransactionLogBackupJob,
  runBackupCleanupJob
};
