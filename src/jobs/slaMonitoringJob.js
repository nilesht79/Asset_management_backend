/**
 * SLA MONITORING BACKGROUND JOB
 * Runs periodically to:
 * 1. Update elapsed time for all active SLA tracking
 * 2. Process escalations
 * 3. Send notifications
 *
 * Can be run via cron job or called manually via API
 */

const SlaTrackingModel = require('../models/slaTracking');
const escalationEngine = require('../services/escalationEngine');
const slaNotificationService = require('../services/slaNotificationService');

class SlaMonitoringJob {
  constructor() {
    this.isRunning = false;
    this.lastRunAt = null;
    this.runInterval = null;
  }

  /**
   * Start the monitoring job with interval
   * @param {number} intervalMinutes - Interval in minutes (default: 5)
   */
  start(intervalMinutes = 5) {
    if (this.runInterval) {
      console.log('SLA monitoring job already running');
      return;
    }

    console.log(`Starting SLA monitoring job with ${intervalMinutes} minute interval`);

    // Run immediately
    this.run();

    // Then run at interval
    this.runInterval = setInterval(() => {
      this.run();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop the monitoring job
   */
  stop() {
    if (this.runInterval) {
      clearInterval(this.runInterval);
      this.runInterval = null;
      console.log('SLA monitoring job stopped');
    }
  }

  /**
   * Run a single monitoring cycle
   */
  async run() {
    if (this.isRunning) {
      console.log('SLA monitoring job already in progress, skipping...');
      return {
        skipped: true,
        reason: 'Previous run still in progress'
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const results = {
      started_at: new Date().toISOString(),
      tracking_updates: { success: 0, error: 0 },
      escalations: { processed: 0, triggered: 0 },
      notifications: { sent: 0, failed: 0 },
      errors: []
    };

    try {
      console.log('=== SLA MONITORING JOB STARTED ===');

      // Step 1: Update all active SLA tracking
      console.log('Step 1: Updating SLA tracking...');
      try {
        const trackingUpdates = await SlaTrackingModel.updateAllActiveTracking();
        results.tracking_updates.success = trackingUpdates.filter(r => r.status === 'updated').length;
        results.tracking_updates.error = trackingUpdates.filter(r => r.status === 'error').length;
        console.log(`  Updated: ${results.tracking_updates.success}, Errors: ${results.tracking_updates.error}`);
      } catch (err) {
        console.error('Error updating SLA tracking:', err);
        results.errors.push({ step: 'tracking_updates', error: err.message });
      }

      // Step 2: Process escalations
      console.log('Step 2: Processing escalations...');
      try {
        const escalationResults = await escalationEngine.processAllPendingEscalations();
        results.escalations.processed = escalationResults.length;
        results.escalations.triggered = escalationResults.reduce(
          (sum, r) => sum + (r.escalations_triggered || 0), 0
        );
        console.log(`  Processed: ${results.escalations.processed}, Triggered: ${results.escalations.triggered}`);
      } catch (err) {
        console.error('Error processing escalations:', err);
        results.errors.push({ step: 'escalations', error: err.message });
      }

      // Step 3: Send pending notifications
      console.log('Step 3: Sending notifications...');
      try {
        const notificationResults = await slaNotificationService.processPendingNotifications();
        results.notifications.sent = notificationResults.filter(r => r.status === 'sent').length;
        results.notifications.failed = notificationResults.filter(r => r.status === 'failed').length;
        console.log(`  Sent: ${results.notifications.sent}, Failed: ${results.notifications.failed}`);
      } catch (err) {
        console.error('Error sending notifications:', err);
        results.errors.push({ step: 'notifications', error: err.message });
      }

      results.completed_at = new Date().toISOString();
      results.duration_ms = Date.now() - startTime;

      console.log(`=== SLA MONITORING JOB COMPLETED (${results.duration_ms}ms) ===`);

      this.lastRunAt = new Date();
      return results;
    } catch (error) {
      console.error('SLA monitoring job failed:', error);
      results.errors.push({ step: 'general', error: error.message });
      results.failed = true;
      return results;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      is_running: this.isRunning,
      last_run_at: this.lastRunAt,
      interval_active: !!this.runInterval
    };
  }

  /**
   * Run with summary report
   */
  async runWithReport() {
    const results = await this.run();

    // Generate summary report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        tracking_updated: results.tracking_updates.success,
        tracking_errors: results.tracking_updates.error,
        escalations_triggered: results.escalations.triggered,
        notifications_sent: results.notifications.sent,
        notifications_failed: results.notifications.failed,
        total_errors: results.errors.length
      },
      duration_ms: results.duration_ms,
      status: results.errors.length === 0 ? 'success' : 'completed_with_errors'
    };

    return report;
  }
}

// Export singleton instance
const slaMonitoringJob = new SlaMonitoringJob();

// Also export the class for testing
module.exports = slaMonitoringJob;
module.exports.SlaMonitoringJob = SlaMonitoringJob;
