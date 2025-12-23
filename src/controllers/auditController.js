/**
 * AUDIT CONTROLLER
 * Handles API endpoints for viewing and managing audit logs
 */

const AuditLogModel = require('../models/auditLog');
const { sendSuccess, sendError, sendPaginatedResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error-handler');

/**
 * Get audit logs with filters and pagination
 * GET /api/v1/audit-logs
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    start_date,
    end_date,
    user_id,
    user_email,
    action,
    action_category,
    action_type,
    resource_type,
    resource_id,
    status,
    ip_address,
    search
  } = req.query;

  const filters = {
    start_date,
    end_date,
    user_id,
    user_email,
    action,
    action_category,
    action_type,
    resource_type,
    resource_id,
    status,
    ip_address,
    search
  };

  // Remove undefined filters
  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined || filters[key] === '') {
      delete filters[key];
    }
  });

  const result = await AuditLogModel.getLogs(filters, { page, limit });

  if (!result) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendPaginatedResponse(res, result.logs, result.pagination, 'Audit logs retrieved successfully');
});

/**
 * Get a single audit log by ID
 * GET /api/v1/audit-logs/:id
 */
const getAuditLogById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const log = await AuditLogModel.getLogById(id);

  if (!log) {
    return sendError(res, 'Audit log not found', 404);
  }

  return sendSuccess(res, log, 'Audit log retrieved successfully');
});

/**
 * Get login audit logs
 * GET /api/v1/audit-logs/login
 */
const getLoginLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    start_date,
    end_date,
    user_id,
    event_type,
    status,
    ip_address
  } = req.query;

  const filters = { start_date, end_date, user_id, event_type, status, ip_address };

  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined || filters[key] === '') {
      delete filters[key];
    }
  });

  const result = await AuditLogModel.getLoginLogs(filters, { page, limit });

  if (!result) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendPaginatedResponse(res, result.logs, result.pagination, 'Login logs retrieved successfully');
});

/**
 * Get audit statistics for dashboard
 * GET /api/v1/audit-logs/statistics
 */
const getStatistics = asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;

  const stats = await AuditLogModel.getStatistics({ days: parseInt(days) });

  if (!stats) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendSuccess(res, stats, 'Audit statistics retrieved successfully');
});

/**
 * Get user activity timeline
 * GET /api/v1/audit-logs/user/:userId
 */
const getUserActivity = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const result = await AuditLogModel.getUserActivity(userId, { page, limit });

  if (!result) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendPaginatedResponse(res, result.logs, result.pagination, 'User activity retrieved successfully');
});

/**
 * Get resource history
 * GET /api/v1/audit-logs/resource/:resourceType/:resourceId
 */
const getResourceHistory = asyncHandler(async (req, res) => {
  const { resourceType, resourceId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const result = await AuditLogModel.getResourceHistory(resourceType, resourceId, { page, limit });

  if (!result) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendPaginatedResponse(res, result.logs, result.pagination, 'Resource history retrieved successfully');
});

/**
 * Get daily summaries
 * GET /api/v1/audit-logs/summaries
 */
const getDailySummaries = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;

  const summaries = await AuditLogModel.getDailySummaries({ days: parseInt(days) });

  if (!summaries) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendSuccess(res, summaries, 'Daily summaries retrieved successfully');
});

/**
 * Export audit logs
 * GET /api/v1/audit-logs/export
 */
const exportLogs = asyncHandler(async (req, res) => {
  const { start_date, end_date, action_category, format = 'json' } = req.query;

  const logs = await AuditLogModel.exportLogs({ start_date, end_date, action_category });

  if (!logs) {
    return sendError(res, 'Audit database not available', 503);
  }

  if (format === 'csv') {
    // Convert to CSV
    if (logs.length === 0) {
      return res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=audit_logs.csv'
      }).send('No data');
    }

    const headers = Object.keys(logs[0]);
    const csvRows = [headers.join(',')];

    for (const row of logs) {
      const values = headers.map(header => {
        let value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') value = JSON.stringify(value);
        // Escape quotes and wrap in quotes if contains comma
        value = String(value).replace(/"/g, '""');
        if (value.includes(',') || value.includes('\n') || value.includes('"')) {
          value = `"${value}"`;
        }
        return value;
      });
      csvRows.push(values.join(','));
    }

    return res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=audit_logs_${new Date().toISOString().split('T')[0]}.csv`
    }).send(csvRows.join('\n'));
  }

  return sendSuccess(res, logs, 'Logs exported successfully');
});

/**
 * Get retention configuration
 * GET /api/v1/audit-logs/retention
 */
const getRetentionConfig = asyncHandler(async (req, res) => {
  const config = await AuditLogModel.getRetentionConfig();

  if (!config) {
    return sendError(res, 'Audit database not available', 503);
  }

  return sendSuccess(res, config, 'Retention configuration retrieved successfully');
});

/**
 * Update retention configuration
 * PUT /api/v1/audit-logs/retention/:category
 */
const updateRetentionConfig = asyncHandler(async (req, res) => {
  const { category } = req.params;
  const { retention_days, archive_days } = req.body;

  if (!retention_days || !archive_days) {
    return sendError(res, 'retention_days and archive_days are required', 400);
  }

  if (retention_days < 1 || archive_days < retention_days) {
    return sendError(res, 'Invalid retention configuration', 400);
  }

  const updated = await AuditLogModel.updateRetentionConfig(
    category,
    { retention_days, archive_days },
    req.user.id || req.user.user_id
  );

  if (!updated) {
    return sendError(res, 'Failed to update retention configuration', 500);
  }

  return sendSuccess(res, updated, 'Retention configuration updated successfully');
});

/**
 * Run archive job manually
 * POST /api/v1/audit-logs/archive
 */
const runArchiveJob = asyncHandler(async (req, res) => {
  const result = await AuditLogModel.runArchiveJob();

  if (!result) {
    return sendError(res, 'Failed to run archive job', 500);
  }

  return sendSuccess(res, result, 'Archive job completed successfully');
});

/**
 * Generate daily summary manually
 * POST /api/v1/audit-logs/generate-summary
 * Body: { date?: string, generate_all?: boolean }
 * - date: Specific date to generate summary for (default: today)
 * - generate_all: If true, generates summaries for all dates missing summaries
 */
const generateSummary = asyncHandler(async (req, res) => {
  const { date, generate_all } = req.body;

  const result = await AuditLogModel.generateDailySummary(
    date ? new Date(date) : null,
    generate_all === true
  );

  if (!result) {
    return sendError(res, 'Failed to generate summary', 500);
  }

  // Build appropriate message based on result
  let message;
  if (generate_all) {
    message = result.dates_processed > 0
      ? `Summary generated: ${result.summaries_created} entries created for ${result.dates_processed} dates`
      : 'No dates found that need summary generation';
  } else if (result.summaries_created === 0) {
    message = result.message || 'No audit logs found for the specified date';
  } else {
    message = `Summary generated: ${result.summaries_created} entries created from ${result.logs_processed} logs`;
  }

  return sendSuccess(res, result, message);
});

/**
 * Get filter options for audit logs
 * GET /api/v1/audit-logs/filter-options
 */
const getFilterOptions = asyncHandler(async (req, res) => {
  const options = {
    action_categories: [
      { value: 'auth', label: 'Authentication' },
      { value: 'user', label: 'User Management' },
      { value: 'asset', label: 'Assets' },
      { value: 'ticket', label: 'Tickets' },
      { value: 'requisition', label: 'Requisitions' },
      { value: 'permission', label: 'Permissions' },
      { value: 'master', label: 'Master Data' },
      { value: 'system', label: 'System' },
      { value: 'file', label: 'Files' },
      { value: 'job', label: 'Jobs' },
      { value: 'security', label: 'Security' },
      { value: 'report', label: 'Reports' }
    ],
    action_types: [
      { value: 'CREATE', label: 'Create' },
      { value: 'READ', label: 'Read' },
      { value: 'UPDATE', label: 'Update' },
      { value: 'DELETE', label: 'Delete' },
      { value: 'LOGIN', label: 'Login' },
      { value: 'LOGOUT', label: 'Logout' },
      { value: 'EXPORT', label: 'Export' },
      { value: 'IMPORT', label: 'Import' },
      { value: 'APPROVE', label: 'Approve' },
      { value: 'REJECT', label: 'Reject' },
      { value: 'ASSIGN', label: 'Assign' },
      { value: 'EXECUTE', label: 'Execute' }
    ],
    statuses: [
      { value: 'success', label: 'Success' },
      { value: 'failure', label: 'Failure' },
      { value: 'error', label: 'Error' }
    ],
    login_event_types: [
      { value: 'login_success', label: 'Login Success' },
      { value: 'login_failed', label: 'Login Failed' },
      { value: 'logout', label: 'Logout' },
      { value: 'token_refresh', label: 'Token Refresh' },
      { value: 'password_reset', label: 'Password Reset' }
    ]
  };

  return sendSuccess(res, options, 'Filter options retrieved successfully');
});

module.exports = {
  getAuditLogs,
  getAuditLogById,
  getLoginLogs,
  getStatistics,
  getUserActivity,
  getResourceHistory,
  getDailySummaries,
  exportLogs,
  getRetentionConfig,
  updateRetentionConfig,
  runArchiveJob,
  generateSummary,
  getFilterOptions
};
