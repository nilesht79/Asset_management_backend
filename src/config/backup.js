/**
 * BACKUP CONFIGURATION
 * Configuration for database backup and disaster recovery
 */

require('dotenv').config();
const path = require('path');

const backupConfig = {
  // Backup storage locations
  storage: {
    // Local backup directory
    localPath: process.env.BACKUP_LOCAL_PATH || path.join(__dirname, '../../backups'),

    // Cloud storage (S3 compatible)
    cloud: {
      enabled: process.env.BACKUP_CLOUD_ENABLED === 'true',
      provider: process.env.BACKUP_CLOUD_PROVIDER || 's3', // s3, azure, gcs
      bucket: process.env.BACKUP_CLOUD_BUCKET || 'database-backups',
      region: process.env.BACKUP_CLOUD_REGION || 'ap-south-1',
      accessKeyId: process.env.BACKUP_CLOUD_ACCESS_KEY,
      secretAccessKey: process.env.BACKUP_CLOUD_SECRET_KEY,
      endpoint: process.env.BACKUP_CLOUD_ENDPOINT // For S3-compatible services
    }
  },

  // Databases to backup
  databases: [
    {
      name: process.env.DB_NAME || 'asset_management',
      type: 'main',
      priority: 1
    },
    {
      name: process.env.AUDIT_DB_NAME || 'audit_logs',
      type: 'audit',
      priority: 2
    }
  ],

  // Backup schedule (cron expressions)
  schedule: {
    // Full backup - Daily at 2:00 AM
    full: process.env.BACKUP_FULL_SCHEDULE || '0 2 * * *',

    // Differential backup - Every 6 hours (6 AM, 12 PM, 6 PM, 12 AM)
    differential: process.env.BACKUP_DIFF_SCHEDULE || '0 6,12,18,0 * * *',

    // Transaction log backup - Every 30 minutes (for point-in-time recovery)
    transactionLog: process.env.BACKUP_LOG_SCHEDULE || '*/30 * * * *',

    // Cleanup job - Daily at 3:00 AM
    cleanup: process.env.BACKUP_CLEANUP_SCHEDULE || '0 3 * * *'
  },

  // Retention policies (in days)
  retention: {
    local: {
      full: parseInt(process.env.BACKUP_RETENTION_FULL) || 7,        // Keep 7 days of full backups locally
      differential: parseInt(process.env.BACKUP_RETENTION_DIFF) || 3, // Keep 3 days of diff backups
      transactionLog: parseInt(process.env.BACKUP_RETENTION_LOG) || 2  // Keep 2 days of log backups
    },
    cloud: {
      full: parseInt(process.env.BACKUP_CLOUD_RETENTION_FULL) || 30,  // Keep 30 days in cloud
      differential: parseInt(process.env.BACKUP_CLOUD_RETENTION_DIFF) || 14,
      transactionLog: parseInt(process.env.BACKUP_CLOUD_RETENTION_LOG) || 7
    }
  },

  // Compression settings
  compression: {
    enabled: process.env.BACKUP_COMPRESSION !== 'false', // Default true
    level: process.env.BACKUP_COMPRESSION_LEVEL || 'MAXTRANSFERSIZE = 4194304, BLOCKSIZE = 65536'
  },

  // Notification settings
  notifications: {
    enabled: process.env.BACKUP_NOTIFICATIONS_ENABLED !== 'false',
    email: {
      recipients: (process.env.BACKUP_NOTIFY_EMAILS || '').split(',').filter(Boolean),
      onSuccess: process.env.BACKUP_NOTIFY_ON_SUCCESS === 'true',
      onFailure: process.env.BACKUP_NOTIFY_ON_FAILURE !== 'false' // Default true
    }
  },

  // Verification settings
  verification: {
    enabled: process.env.BACKUP_VERIFY !== 'false', // Default true
    checksumValidation: true,
    restoreTest: {
      enabled: process.env.BACKUP_RESTORE_TEST === 'true',
      schedule: '0 5 * * 0' // Weekly on Sunday at 5 AM
    }
  },

  // SQL Server specific settings
  sqlServer: {
    backupDirectory: process.env.SQL_BACKUP_DIRECTORY || '/var/opt/mssql/backup',
    useCompression: true,
    copyOnly: false, // Set to true if using other backup solutions
    initWithNoRecovery: false
  }
};

// Validate configuration
const validateConfig = () => {
  const errors = [];

  if (!backupConfig.storage.localPath) {
    errors.push('Backup local path is required');
  }

  if (backupConfig.storage.cloud.enabled) {
    if (!backupConfig.storage.cloud.bucket) {
      errors.push('Cloud bucket name is required when cloud backup is enabled');
    }
    if (!backupConfig.storage.cloud.accessKeyId || !backupConfig.storage.cloud.secretAccessKey) {
      errors.push('Cloud credentials are required when cloud backup is enabled');
    }
  }

  return errors;
};

module.exports = {
  backupConfig,
  validateConfig
};
