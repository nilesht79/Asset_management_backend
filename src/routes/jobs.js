/**
 * Job Management Routes
 * Admin endpoints to manage and trigger scheduled jobs
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { getJobStatus, triggerJob } = require('../config/scheduler');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * GET /api/v1/jobs/status
 * Get status of all scheduled jobs
 */
router.get('/status', authenticateToken, requireRole(['superadmin', 'admin']), async (req, res) => {
  try {
    const status = getJobStatus();

    return sendSuccess(res, 'Job status retrieved successfully', {
      jobs: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    return sendError(res, 'Failed to get job status', 500);
  }
});

/**
 * POST /api/v1/jobs/trigger/:jobName
 * Manually trigger a specific job
 */
router.post('/trigger/:jobName', authenticateToken, requireRole(['superadmin', 'admin']), async (req, res) => {
  try {
    const { jobName } = req.params;

    await triggerJob(jobName);

    return sendSuccess(res, `Job ${jobName} triggered successfully`, {
      job: jobName,
      triggered_at: new Date().toISOString(),
      triggered_by: req.user.email
    });
  } catch (error) {
    console.error('Error triggering job:', error);
    return sendError(res, error.message || 'Failed to trigger job', 500);
  }
});

module.exports = router;
