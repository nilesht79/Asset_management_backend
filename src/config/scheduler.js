/**
 * Job Scheduler Configuration
 * Sets up cron jobs for automated tasks
 */

const cron = require('node-cron');
const { runStandbyJobs } = require('../jobs/standbyAutoConversion');

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

  // Optional: Run immediately on startup (for testing)
  if (process.env.RUN_JOBS_ON_STARTUP === 'true') {
    console.log('🔄 Running jobs on startup...');
    runStandbyJobs().catch(error => {
      console.error('❌ Startup job execution failed:', error);
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
