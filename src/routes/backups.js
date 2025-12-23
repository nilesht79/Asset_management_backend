/**
 * BACKUP ROUTES
 * API endpoints for backup management and disaster recovery
 */

const express = require('express');
const router = express.Router();
const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRoles } = require('../middleware/auth');
const backupController = require('../controllers/backupController');

// All backup routes require authentication
router.use(authenticateOAuth);

// ==========================================
// READ ENDPOINTS (Admin access)
// ==========================================

/**
 * GET /api/v1/backups/status
 * Get backup status and health information
 */
router.get(
  '/status',
  requireRoles('superadmin', 'admin'),
  backupController.getBackupStatus
);

/**
 * GET /api/v1/backups/history
 * Get backup history with optional filters
 * Query params: database, type, startDate, limit
 */
router.get(
  '/history',
  requireRoles('superadmin', 'admin'),
  backupController.getBackupHistory
);

/**
 * GET /api/v1/backups/config
 * Get current backup configuration (sanitized)
 */
router.get(
  '/config',
  requireRoles('superadmin', 'admin'),
  backupController.getBackupConfig
);

/**
 * GET /api/v1/backups/files
 * Get list of available backup files
 * Query params: database, type
 */
router.get(
  '/files',
  requireRoles('superadmin', 'admin'),
  backupController.getBackupFiles
);

// ==========================================
// WRITE ENDPOINTS (Superadmin only)
// ==========================================

/**
 * POST /api/v1/backups/full
 * Trigger a full backup
 * Body: { database?: string } - optional, backs up all if not specified
 */
router.post(
  '/full',
  requireRoles('superadmin'),
  backupController.triggerFullBackup
);

/**
 * POST /api/v1/backups/differential
 * Trigger a differential backup
 * Body: { database?: string }
 */
router.post(
  '/differential',
  requireRoles('superadmin'),
  backupController.triggerDifferentialBackup
);

/**
 * POST /api/v1/backups/transaction-log
 * Trigger a transaction log backup
 * Body: { database?: string }
 */
router.post(
  '/transaction-log',
  requireRoles('superadmin'),
  backupController.triggerTransactionLogBackup
);

/**
 * POST /api/v1/backups/verify
 * Verify a backup file integrity
 * Body: { database: string, backupPath: string }
 */
router.post(
  '/verify',
  requireRoles('superadmin'),
  backupController.verifyBackup
);

/**
 * POST /api/v1/backups/cleanup
 * Trigger cleanup of old backup files
 */
router.post(
  '/cleanup',
  requireRoles('superadmin'),
  backupController.triggerCleanup
);

/**
 * POST /api/v1/backups/restore
 * Restore database from backup (DANGEROUS)
 * Body: { database: string, backupPath: string, confirmRestore: string }
 * confirmRestore must be "I_UNDERSTAND_THIS_WILL_OVERWRITE_DATA"
 */
router.post(
  '/restore',
  requireRoles('superadmin'),
  backupController.restoreDatabase
);

module.exports = router;
