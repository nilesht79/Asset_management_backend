/**
 * AUDIT RETENTION JOB
 * Automated job to archive old audit logs and generate daily summaries
 */

const AuditLogModel = require('../models/auditLog');
const { auditService } = require('../services/auditService');

/**
 * Run the audit retention job
 * - Archives logs older than retention period
 * - Deletes archived logs older than archive period
 * - Generates daily summary for previous day
 */
async function runAuditRetentionJob() {
  const startTime = Date.now();
  console.log('[AuditRetentionJob] Starting audit retention job...');

  try {
    // 1. Run archive job
    console.log('[AuditRetentionJob] Running archive process...');
    const archiveResult = await AuditLogModel.runArchiveJob();

    if (archiveResult) {
      console.log(`[AuditRetentionJob] Archived ${archiveResult.archived_count} logs, deleted ${archiveResult.deleted_count} from main table`);
    } else {
      console.warn('[AuditRetentionJob] Archive job returned no result (audit DB may be unavailable)');
    }

    // 2. Generate daily summary for yesterday
    console.log('[AuditRetentionJob] Generating daily summary...');
    const summaryResult = await AuditLogModel.generateDailySummary();

    if (summaryResult) {
      console.log(`[AuditRetentionJob] Generated ${summaryResult.summaries_created} summary entries`);
    } else {
      console.warn('[AuditRetentionJob] Summary generation returned no result');
    }

    const duration = Date.now() - startTime;
    console.log(`[AuditRetentionJob] Job completed in ${duration}ms`);

    // Log job completion to audit
    auditService.logJobExecution('audit_retention', 'completed', {
      archived_count: archiveResult?.archived_count || 0,
      deleted_count: archiveResult?.deleted_count || 0,
      summaries_created: summaryResult?.summaries_created || 0,
      duration_ms: duration
    });

    return {
      success: true,
      archived: archiveResult?.archived_count || 0,
      deleted: archiveResult?.deleted_count || 0,
      summaries: summaryResult?.summaries_created || 0,
      duration_ms: duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[AuditRetentionJob] Job failed:', error.message);

    // Log job failure to audit
    auditService.logJobExecution('audit_retention', 'failed', {
      error: error.message,
      duration_ms: duration
    });

    return {
      success: false,
      error: error.message,
      duration_ms: duration
    };
  }
}

module.exports = {
  runAuditRetentionJob
};
