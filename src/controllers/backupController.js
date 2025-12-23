/**
 * BACKUP CONTROLLER
 * Handles API endpoints for backup management
 */

const backupService = require('../services/backupService');
const { backupConfig } = require('../config/backup');
const { sendSuccess, sendError } = require('../utils/response');
const { asyncHandler } = require('../middleware/error-handler');

/**
 * Get backup status and health
 * GET /api/v1/backups/status
 */
const getBackupStatus = asyncHandler(async (req, res) => {
  const status = await backupService.getBackupStatus();
  return sendSuccess(res, status, 'Backup status retrieved successfully');
});

/**
 * Get backup history
 * GET /api/v1/backups/history
 */
const getBackupHistory = asyncHandler(async (req, res) => {
  const { database, type, startDate, limit } = req.query;

  const history = await backupService.getBackupHistory({
    database,
    type,
    startDate,
    limit: parseInt(limit) || 100
  });

  return sendSuccess(res, history, 'Backup history retrieved successfully');
});

/**
 * Get backup configuration
 * GET /api/v1/backups/config
 */
const getBackupConfig = asyncHandler(async (req, res) => {
  // Return sanitized config (no secrets)
  const config = {
    databases: backupConfig.databases,
    schedule: backupConfig.schedule,
    retention: backupConfig.retention,
    compression: { enabled: backupConfig.compression.enabled },
    notifications: {
      enabled: backupConfig.notifications.enabled,
      onSuccess: backupConfig.notifications.email.onSuccess,
      onFailure: backupConfig.notifications.email.onFailure,
      recipientCount: backupConfig.notifications.email.recipients.length
    },
    verification: {
      enabled: backupConfig.verification.enabled,
      restoreTestEnabled: backupConfig.verification.restoreTest.enabled
    },
    cloudEnabled: backupConfig.storage.cloud.enabled
  };

  return sendSuccess(res, config, 'Backup configuration retrieved successfully');
});

/**
 * Trigger manual full backup
 * POST /api/v1/backups/full
 */
const triggerFullBackup = asyncHandler(async (req, res) => {
  const { database } = req.body;

  let result;
  if (database) {
    // Backup specific database
    result = await backupService.performFullBackup(database);
  } else {
    // Backup all databases
    result = await backupService.runScheduledBackups('full');
  }

  if (result.success) {
    return sendSuccess(res, result, 'Full backup completed successfully');
  } else {
    return sendError(res, 'Backup failed: ' + (result.error || 'Unknown error'), 500);
  }
});

/**
 * Trigger manual differential backup
 * POST /api/v1/backups/differential
 */
const triggerDifferentialBackup = asyncHandler(async (req, res) => {
  const { database } = req.body;

  let result;
  if (database) {
    result = await backupService.performDifferentialBackup(database);
  } else {
    result = await backupService.runScheduledBackups('differential');
  }

  if (result.success) {
    return sendSuccess(res, result, 'Differential backup completed successfully');
  } else {
    return sendError(res, 'Backup failed: ' + (result.error || 'Unknown error'), 500);
  }
});

/**
 * Trigger manual transaction log backup
 * POST /api/v1/backups/transaction-log
 */
const triggerTransactionLogBackup = asyncHandler(async (req, res) => {
  const { database } = req.body;

  let result;
  if (database) {
    result = await backupService.performTransactionLogBackup(database);
  } else {
    result = await backupService.runScheduledBackups('transactionLog');
  }

  if (result.success) {
    return sendSuccess(res, result, 'Transaction log backup completed successfully');
  } else {
    return sendError(res, 'Backup failed: ' + (result.error || 'Unknown error'), 500);
  }
});

/**
 * Verify a backup file
 * POST /api/v1/backups/verify
 */
const verifyBackup = asyncHandler(async (req, res) => {
  const { database, backupPath } = req.body;

  if (!database || !backupPath) {
    return sendError(res, 'database and backupPath are required', 400);
  }

  const result = await backupService.verifyBackup(database, backupPath);

  if (result.valid) {
    return sendSuccess(res, result, 'Backup verification successful');
  } else {
    return sendError(res, 'Backup verification failed: ' + result.error, 400);
  }
});

/**
 * Trigger cleanup of old backups
 * POST /api/v1/backups/cleanup
 */
const triggerCleanup = asyncHandler(async (req, res) => {
  const result = await backupService.cleanupOldBackups();

  return sendSuccess(res, result, `Cleanup completed: ${result.deleted.length} files deleted`);
});

/**
 * Restore database from backup (DANGEROUS - requires confirmation)
 * POST /api/v1/backups/restore
 */
const restoreDatabase = asyncHandler(async (req, res) => {
  const { database, backupPath, confirmRestore } = req.body;

  if (!database || !backupPath) {
    return sendError(res, 'database and backupPath are required', 400);
  }

  // Require explicit confirmation
  if (confirmRestore !== 'I_UNDERSTAND_THIS_WILL_OVERWRITE_DATA') {
    return sendError(res, 'Restore requires explicit confirmation. Set confirmRestore to "I_UNDERSTAND_THIS_WILL_OVERWRITE_DATA"', 400);
  }

  const result = await backupService.restoreDatabase(database, backupPath);

  if (result.success) {
    return sendSuccess(res, result, 'Database restored successfully');
  } else {
    return sendError(res, 'Restore failed: ' + result.error, 500);
  }
});

/**
 * Get list of available backup files
 * GET /api/v1/backups/files
 */
const getBackupFiles = asyncHandler(async (req, res) => {
  const { database, type } = req.query;

  const history = await backupService.getBackupHistory({ database, type });

  // Transform to file list
  const files = history.map(h => ({
    database: h.database_name,
    type: h.backup_type,
    filename: h.physical_device_name,
    size: h.backup_size,
    compressedSize: h.compressed_backup_size,
    createdAt: h.backup_start_date,
    duration: h.duration_seconds
  }));

  return sendSuccess(res, files, 'Backup files retrieved successfully');
});

module.exports = {
  getBackupStatus,
  getBackupHistory,
  getBackupConfig,
  triggerFullBackup,
  triggerDifferentialBackup,
  triggerTransactionLogBackup,
  verifyBackup,
  triggerCleanup,
  restoreDatabase,
  getBackupFiles
};
