/**
 * Job Scheduler Configuration
 * Sets up cron jobs for automated tasks
 */

const cron = require('node-cron');
const { runStandbyJobs } = require('../jobs/standbyAutoConversion');
const slaMonitoringJob = require('../jobs/slaMonitoringJob');
const notificationCleanupJob = require('../jobs/notificationCleanupJob');
const { runAuditRetentionJob } = require('../jobs/auditRetentionJob');
const { runFullBackupJob, runDifferentialBackupJob, runBackupCleanupJob } = require('../jobs/backupJob');
const warrantyExpirationJob = require('../jobs/warrantyExpirationJob');
const { backupConfig } = require('./backup');

// Track active jobs
const activeJobs = new Map();

/**
 * Initialize all scheduled jobs
 */
const initializeScheduler = () => {
  console.log('🕐 Initializing job scheduler...');

  // Standby Auto-Conversion Job
  // Runs daily at 2:00 AM IST (Indian Standard Time)
  const standbyJob = cron.schedule('0 2 * * *', async () => {
    console.log('⏰ Running standby auto-conversion job...');
    try {
      await runStandbyJobs();
      console.log('✅ Standby auto-conversion job completed successfully');
    } catch (error) {
      console.error('❌ Standby auto-conversion job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'  // IST timezone
  });

  activeJobs.set('standbyAutoConversion', standbyJob);

  // SLA Monitoring Job
  // Runs every 5 minutes to update SLA tracking, process escalations, and send notifications
  const slaJob = cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Running SLA monitoring job...');
    try {
      const result = await slaMonitoringJob.run();
      console.log(`✅ SLA monitoring job completed: ${result.tracking_updates?.success || 0} updated, ${result.escalations?.triggered || 0} escalations`);
    } catch (error) {
      console.error('❌ SLA monitoring job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'
  });

  activeJobs.set('slaMonitoring', slaJob);

  // Notification Cleanup Job
  // Runs daily at 3:00 AM IST to delete old read notifications
  const notificationCleanup = cron.schedule('0 3 * * *', async () => {
    console.log('⏰ Running notification cleanup job...');
    try {
      const result = await notificationCleanupJob.run();
      if (result.success) {
        console.log(`✅ Notification cleanup completed: ${result.deletedCount} notifications deleted`);
      } else {
        console.error(`❌ Notification cleanup failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Notification cleanup job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'  // IST timezone
  });

  activeJobs.set('notificationCleanup', notificationCleanup);

  // Audit Retention Job
  // Runs daily at 4:00 AM IST to archive old logs and generate summaries
  const auditRetention = cron.schedule('0 4 * * *', async () => {
    console.log('⏰ Running audit retention job...');
    try {
      const result = await runAuditRetentionJob();
      if (result.success) {
        console.log(`✅ Audit retention completed: ${result.archived} archived, ${result.summaries} summaries`);
      } else {
        console.error(`❌ Audit retention failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Audit retention job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'
  });

  activeJobs.set('auditRetention', auditRetention);

  // Warranty & EOSL Expiration Alert Job
  // Runs daily at 8:00 AM IST to notify about assets expiring in 7 days
  const warrantyAlert = cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Running warranty/EOSL expiration alert job...');
    try {
      const result = await warrantyExpirationJob.run();
      if (result.success) {
        console.log(`✅ Warranty alert job completed: ${result.warranty_alerts_sent} warranty, ${result.eosl_alerts_sent} EOSL alerts sent`);
      } else {
        console.error(`❌ Warranty alert job failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Warranty alert job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'
  });

  activeJobs.set('warrantyExpiration', warrantyAlert);

  // Database Full Backup Job
  // Runs daily at 2:00 AM IST (configurable via backupConfig)
  const fullBackupJob = cron.schedule(backupConfig.schedule.full, async () => {
    console.log('⏰ Running full database backup job...');
    try {
      const result = await runFullBackupJob();
      if (result.success) {
        console.log(`✅ Full backup completed: ${result.databases?.length || 0} databases backed up`);
      } else {
        console.error(`❌ Full backup failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Full backup job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'
  });

  activeJobs.set('fullBackup', fullBackupJob);

  // Database Differential Backup Job
  // Runs every 6 hours (configurable via backupConfig)
  const diffBackupJob = cron.schedule(backupConfig.schedule.differential, async () => {
    console.log('⏰ Running differential database backup job...');
    try {
      const result = await runDifferentialBackupJob();
      if (result.success) {
        console.log(`✅ Differential backup completed: ${result.databases?.length || 0} databases backed up`);
      } else {
        console.error(`❌ Differential backup failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Differential backup job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'
  });

  activeJobs.set('differentialBackup', diffBackupJob);

  // Backup Cleanup Job
  // Runs daily at 3:00 AM IST to remove old backups
  const backupCleanup = cron.schedule(backupConfig.schedule.cleanup, async () => {
    console.log('⏰ Running backup cleanup job...');
    try {
      const result = await runBackupCleanupJob();
      console.log(`✅ Backup cleanup completed: ${result.deleted?.length || 0} files deleted`);
    } catch (error) {
      console.error('❌ Backup cleanup job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata'
  });

  activeJobs.set('backupCleanup', backupCleanup);

  // Optional: Run immediately on startup (for testing)
  if (process.env.RUN_JOBS_ON_STARTUP === 'true') {
    console.log('🔄 Running jobs on startup...');
    runStandbyJobs().catch(error => {
      console.error('❌ Startup standby job execution failed:', error);
    });
    slaMonitoringJob.run().catch(error => {
      console.error('❌ Startup SLA monitoring job execution failed:', error);
    });
    notificationCleanupJob.run().catch(error => {
      console.error('❌ Startup notification cleanup job execution failed:', error);
    });
    warrantyExpirationJob.run().catch(error => {
      console.error('❌ Startup warranty alert job execution failed:', error);
    });
  }

  console.log('✅ Job scheduler initialized successfully');
  console.log('📋 Active jobs:', Array.from(activeJobs.keys()).join(', '));
};

/**
 * Stop all scheduled jobs
 */
const stopScheduler = () => {
  console.log('🛑 Stopping all scheduled jobs...');

  activeJobs.forEach((job, name) => {
    job.stop();
    console.log(`  ⏹️  Stopped: ${name}`);
  });

  activeJobs.clear();
  console.log('✅ All jobs stopped');
};

/**
 * Get status of all jobs
 */
const getJobStatus = () => {
  const status = {};

  activeJobs.forEach((job, name) => {
    status[name] = {
      running: job.running || false,
      scheduled: true
    };
  });

  return status;
};

/**
 * Manually trigger a specific job
 */
const triggerJob = async (jobName) => {
  console.log(`🔄 Manually triggering job: ${jobName}`);

  switch (jobName) {
    case 'standbyAutoConversion':
      await runStandbyJobs();
      break;
    case 'slaMonitoring':
      await slaMonitoringJob.run();
      break;
    case 'notificationCleanup':
      await notificationCleanupJob.run();
      break;
    case 'auditRetention':
      await runAuditRetentionJob();
      break;
    case 'fullBackup':
      await runFullBackupJob();
      break;
    case 'differentialBackup':
      await runDifferentialBackupJob();
      break;
    case 'backupCleanup':
      await runBackupCleanupJob();
      break;
    case 'warrantyExpiration':
      await warrantyExpirationJob.run();
      break;
    default:
      throw new Error(`Unknown job: ${jobName}`);
  }

  console.log(`✅ Job ${jobName} completed`);
};

module.exports = {
  initializeScheduler,
  stopScheduler,
  getJobStatus,
  triggerJob
};
