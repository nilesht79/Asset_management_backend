/**
 * AUDIT LOGS ROUTES
 * API endpoints for querying and managing audit logs
 */

const express = require('express');
const router = express.Router();
const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRoles } = require('../middleware/auth');
const auditController = require('../controllers/auditController');

// All audit routes require authentication
router.use(authenticateOAuth);

// ==========================================
// READ ENDPOINTS (Admin access)
// ==========================================

/**
 * GET /api/v1/audit-logs/filter-options
 * Get available filter options for the UI
 */
router.get(
  '/filter-options',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getFilterOptions
);

/**
 * GET /api/v1/audit-logs/statistics
 * Get audit statistics for dashboard
 */
router.get(
  '/statistics',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getStatistics
);

/**
 * GET /api/v1/audit-logs/login
 * Get login audit logs
 */
router.get(
  '/login',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getLoginLogs
);

/**
 * GET /api/v1/audit-logs/summaries
 * Get daily summaries
 */
router.get(
  '/summaries',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getDailySummaries
);

/**
 * GET /api/v1/audit-logs/export
 * Export audit logs (CSV or JSON)
 */
router.get(
  '/export',
  requireRoles('superadmin', 'admin'),
  auditController.exportLogs
);

/**
 * GET /api/v1/audit-logs/retention
 * Get retention configuration
 */
router.get(
  '/retention',
  requireRoles('superadmin', 'admin'),
  auditController.getRetentionConfig
);

/**
 * GET /api/v1/audit-logs/user/:userId
 * Get activity for a specific user
 */
router.get(
  '/user/:userId',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getUserActivity
);

/**
 * GET /api/v1/audit-logs/resource/:resourceType/:resourceId
 * Get history for a specific resource
 */
router.get(
  '/resource/:resourceType/:resourceId',
  requireRoles('superadmin', 'admin', 'it_head', 'coordinator'),
  auditController.getResourceHistory
);

/**
 * GET /api/v1/audit-logs/:id
 * Get a single audit log by ID
 */
router.get(
  '/:id',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getAuditLogById
);

/**
 * GET /api/v1/audit-logs
 * Get audit logs with filters and pagination
 */
router.get(
  '/',
  requireRoles('superadmin', 'admin', 'it_head'),
  auditController.getAuditLogs
);

// ==========================================
// WRITE ENDPOINTS (Superadmin only)
// ==========================================

/**
 * PUT /api/v1/audit-logs/retention/:category
 * Update retention configuration for a category
 */
router.put(
  '/retention/:category',
  requireRoles('superadmin'),
  auditController.updateRetentionConfig
);

/**
 * POST /api/v1/audit-logs/archive
 * Manually run archive job
 */
router.post(
  '/archive',
  requireRoles('superadmin'),
  auditController.runArchiveJob
);

/**
 * POST /api/v1/audit-logs/generate-summary
 * Manually generate daily summary
 */
router.post(
  '/generate-summary',
  requireRoles('superadmin'),
  auditController.generateSummary
);

module.exports = router;
