/**
 * NOTIFICATION CLEANUP JOB
 * Automatically deletes old read notifications
 * Runs daily to keep the notification table clean
 */

const NotificationModel = require('../models/notification');

/**
 * Configuration for notification cleanup
 */
const CLEANUP_CONFIG = {
  // Delete read notifications older than X days
  daysOld: parseInt(process.env.NOTIFICATION_CLEANUP_DAYS) || 30,

  // Enable/disable cleanup job
  enabled: process.env.NOTIFICATION_CLEANUP_ENABLED !== 'false' // Default: enabled
};

/**
 * Run notification cleanup job
 * @returns {Object} Cleanup result with count of deleted notifications
 */
const runNotificationCleanup = async () => {
  const startTime = Date.now();

  try {
    console.log('🧹 Starting notification cleanup job...');
    console.log(`   Deleting read notifications older than ${CLEANUP_CONFIG.daysOld} days`);

    if (!CLEANUP_CONFIG.enabled) {
      console.log('⚠️  Notification cleanup is disabled via environment variable');
      return {
        success: true,
        deletedCount: 0,
        skipped: true,
        message: 'Cleanup disabled'
      };
    }

    // Delete old read notifications
    const deletedCount = await NotificationModel.deleteOldNotifications(CLEANUP_CONFIG.daysOld);

    const duration = Date.now() - startTime;

    console.log(`✅ Notification cleanup completed in ${duration}ms`);
    console.log(`   Deleted ${deletedCount} old read notification(s)`);

    return {
      success: true,
      deletedCount,
      daysOld: CLEANUP_CONFIG.daysOld,
      duration,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    console.error('❌ Notification cleanup job failed:', error);

    return {
      success: false,
      error: error.message,
      duration,
      timestamp: new Date().toISOString()
    };
  }
};

module.exports = {
  run: runNotificationCleanup,
  config: CLEANUP_CONFIG
};
