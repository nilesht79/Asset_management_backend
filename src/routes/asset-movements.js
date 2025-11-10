const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { roles: USER_ROLES } = require('../config/auth');
const assetMovementController = require('../controllers/assetMovementController');

/**
 * Asset Movement Routes
 * All routes require authentication
 */

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @route   GET /api/v1/asset-movements/export/excel
 * @desc    Export asset movements to Excel with filters
 * @access  Authenticated users
 */
router.get('/export/excel', assetMovementController.exportToExcel);

/**
 * @route   GET /api/v1/asset-movements/recent
 * @desc    Get recent asset movements (all assets)
 * @access  Authenticated users
 */
router.get('/recent', assetMovementController.getRecentMovements);

/**
 * @route   GET /api/v1/asset-movements/statistics
 * @desc    Get movement statistics for dashboard
 * @access  Admin/SuperAdmin/Coordinator
 */
router.get(
  '/statistics',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR]),
  assetMovementController.getMovementStatistics
);

/**
 * @route   GET /api/v1/asset-movements/asset/:assetId
 * @desc    Get movement history for a specific asset
 * @access  Authenticated users
 */
router.get('/asset/:assetId', assetMovementController.getAssetMovementHistory);

/**
 * @route   GET /api/v1/asset-movements/asset/:assetId/current
 * @desc    Get current assignment for an asset
 * @access  Authenticated users
 */
router.get('/asset/:assetId/current', assetMovementController.getCurrentAssignment);

/**
 * @route   GET /api/v1/asset-movements/user/:userId
 * @desc    Get movement history for a specific user
 * @access  User can view own, Admin can view all
 */
router.get('/user/:userId', assetMovementController.getUserMovementHistory);

/**
 * @route   GET /api/v1/asset-movements/location/:locationId
 * @desc    Get movement history for a specific location
 * @access  Authenticated users
 */
router.get('/location/:locationId', assetMovementController.getLocationMovementHistory);

/**
 * @route   POST /api/v1/asset-movements/asset/:assetId
 * @desc    Create a new movement record (manual entry)
 * @access  Admin/SuperAdmin only
 */
router.post(
  '/asset/:assetId',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  assetMovementController.createMovement
);

module.exports = router;
