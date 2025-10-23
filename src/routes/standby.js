/**
 * Standby Assets and Assignments Routes
 */

const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { requireDynamicPermission, requireRole } = require('../middleware/permissions');
const { validateBody, validateQuery } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/error-handler');

const standbyAssetController = require('../controllers/standbyAssetController');
const standbyAssignmentController = require('../controllers/standbyAssignmentController');
const standbyValidators = require('../validators/standbyValidators');

// Apply authentication to all routes
router.use(authenticateToken);

// ============================================================================
// STANDBY ASSET POOL ROUTES
// ============================================================================

/**
 * GET /api/v1/standby-assets
 * Get all standby assets with filters
 * Access: superadmin, admin, coordinator
 */
router.get(
  '/assets',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(standbyAssetController.getStandbyAssets)
);

/**
 * GET /api/v1/standby-assets/statistics
 * Get standby pool statistics
 * Access: superadmin, admin, coordinator
 */
router.get(
  '/assets/statistics',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(standbyAssetController.getStandbyStatistics)
);

/**
 * POST /api/v1/standby-assets/:id/add
 * Add asset to standby pool
 * Access: superadmin, admin, coordinator
 */
router.post(
  '/assets/:id/add',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(standbyAssetController.addToStandbyPool)
);

/**
 * DELETE /api/v1/standby-assets/:id/remove
 * Remove asset from standby pool
 * Access: superadmin, admin, coordinator
 */
router.delete(
  '/assets/:id/remove',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(standbyAssetController.removeFromStandbyPool)
);

// ============================================================================
// STANDBY ASSIGNMENT ROUTES
// ============================================================================

/**
 * GET /api/v1/standby-assignments
 * Get all standby assignments with filters
 * Access: superadmin, admin, coordinator
 */
router.get(
  '/assignments',
  requireRole(['superadmin', 'admin', 'coordinator']),
  validateQuery(standbyValidators.listQuery),
  asyncHandler(standbyAssignmentController.getStandbyAssignments)
);

/**
 * POST /api/v1/standby-assignments
 * Assign standby asset to user
 * Access: superadmin, admin, coordinator
 */
router.post(
  '/assignments',
  requireRole(['superadmin', 'admin', 'coordinator']),
  validateBody(standbyValidators.assignStandby),
  asyncHandler(standbyAssignmentController.assignStandbyAsset)
);

/**
 * PUT /api/v1/standby-assignments/:id/return
 * Return standby asset and swap back to original
 * Access: superadmin, admin, coordinator
 */
router.put(
  '/assignments/:id/return',
  requireRole(['superadmin', 'admin', 'coordinator']),
  validateBody(standbyValidators.returnStandby),
  asyncHandler(standbyAssignmentController.returnStandbyAsset)
);

/**
 * PUT /api/v1/standby-assignments/:id/permanent
 * Make standby assignment permanent
 * Access: superadmin, admin, coordinator
 */
router.put(
  '/assignments/:id/permanent',
  requireRole(['superadmin', 'admin', 'coordinator']),
  validateBody(standbyValidators.makePermanent),
  asyncHandler(standbyAssignmentController.makeAssignmentPermanent)
);

/**
 * GET /api/v1/standby-assignments/user/:userId
 * Get user's standby assignment history
 * Access: superadmin, admin, coordinator
 */
router.get(
  '/assignments/user/:userId',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(standbyAssignmentController.getUserStandbyHistory)
);

/**
 * GET /api/v1/standby-assignments/asset/:assetId/history
 * Get asset's standby assignment history
 * Access: superadmin, admin, coordinator
 */
router.get(
  '/assignments/asset/:assetId/history',
  requireRole(['superadmin', 'admin', 'coordinator']),
  asyncHandler(standbyAssignmentController.getAssetStandbyHistory)
);

module.exports = router;
