/**
 * FAULT ANALYSIS ROUTES
 * API endpoints for fault analysis and problematic asset tracking
 */

const express = require('express');
const router = express.Router();
const FaultAnalysisController = require('../controllers/faultAnalysisController');
const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRole } = require('../middleware/permissions');

// Roles
const MANAGERS = ['it_head', 'coordinator', 'superadmin', 'department_coordinator', 'admin', 'engineer'];
const ADMINS = ['it_head', 'superadmin', 'admin'];

/**
 * ============================================
 * ANALYSIS ROUTES
 * ============================================
 */

/**
 * @route   GET /api/fault-analysis/stats
 * @desc    Get flag statistics
 * @access  Managers
 */
router.get(
  '/stats',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.getFlagStats
);

/**
 * @route   GET /api/fault-analysis/analyze/assets
 * @desc    Analyze faults for all assets (find problematic ones)
 * @access  Managers
 */
router.get(
  '/analyze/assets',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.analyzeAllAssetFaults
);

/**
 * @route   GET /api/fault-analysis/analyze/asset/:assetId
 * @desc    Analyze faults for a specific asset
 * @access  Managers
 */
router.get(
  '/analyze/asset/:assetId',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.analyzeAssetFaults
);

/**
 * @route   GET /api/fault-analysis/analyze/models
 * @desc    Analyze faults for product models/OEMs
 * @access  Managers
 */
router.get(
  '/analyze/models',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.analyzeModelFaults
);

/**
 * @route   POST /api/fault-analysis/run
 * @desc    Run automatic fault analysis and create flags
 * @access  Admins
 */
router.post(
  '/run',
  authenticateOAuth,
  requireRole(ADMINS),
  FaultAnalysisController.runAutoAnalysis
);

/**
 * ============================================
 * REPORTS ROUTES
 * ============================================
 */

/**
 * @route   GET /api/fault-analysis/reports/problematic-assets
 * @desc    Get problematic assets report
 * @access  Managers
 */
router.get(
  '/reports/problematic-assets',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.getProblematicAssetsReport
);

/**
 * ============================================
 * FLAGS ROUTES
 * ============================================
 */

/**
 * @route   GET /api/fault-analysis/flags
 * @desc    Get all active fault flags
 * @access  Managers
 */
router.get(
  '/flags',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.getActiveFlags
);

/**
 * @route   GET /api/fault-analysis/assets/:assetId/flags
 * @desc    Get flags for a specific asset
 * @access  Managers
 */
router.get(
  '/assets/:assetId/flags',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.getAssetFlags
);

/**
 * @route   GET /api/fault-analysis/products/:productId/flags
 * @desc    Get flags for a product model
 * @access  Managers
 */
router.get(
  '/products/:productId/flags',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.getProductFlags
);

/**
 * @route   POST /api/fault-analysis/flags
 * @desc    Create a manual fault flag
 * @access  Managers
 */
router.post(
  '/flags',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.createFlag
);

/**
 * @route   GET /api/fault-analysis/flags/history
 * @desc    Get resolved flags history
 * @access  Managers
 */
router.get(
  '/flags/history',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.getResolvedFlags
);

/**
 * @route   PUT /api/fault-analysis/flags/:flagId/resolve
 * @desc    Resolve a fault flag
 * @access  Managers
 */
router.put(
  '/flags/:flagId/resolve',
  authenticateOAuth,
  requireRole(MANAGERS),
  FaultAnalysisController.resolveFlag
);

/**
 * @route   DELETE /api/fault-analysis/flags/:flagId
 * @desc    Deactivate a fault flag
 * @access  Admins
 */
router.delete(
  '/flags/:flagId',
  authenticateOAuth,
  requireRole(ADMINS),
  FaultAnalysisController.deactivateFlag
);

module.exports = router;
