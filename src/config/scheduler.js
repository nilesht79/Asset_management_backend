/**
 * Job Scheduler Configuration
 * Sets up cron jobs for automated tasks
 */

const cron = require('node-cron');
const { runStandbyJobs } = require('../jobs/standbyAutoConversion');
const slaMonitoringJob = require('../jobs/slaMonitoringJob');
const notificationCleanupJob = require('../jobs/notificationCleanupJob');

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
