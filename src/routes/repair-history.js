/**
 * REPAIR HISTORY ROUTES
 * API endpoints for asset repair history and fault types
 */

const express = require('express');
const router = express.Router();
const RepairHistoryController = require('../controllers/repairHistoryController');
const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRole } = require('../middleware/permissions');

// Roles
const MANAGERS = ['it_head', 'coordinator', 'superadmin', 'department_coordinator', 'admin', 'engineer'];
const ADMINS = ['it_head', 'superadmin', 'admin'];

/**
 * ============================================
 * FAULT TYPES ROUTES
 * ============================================
 */

/**
 * @route   GET /api/repair-history/fault-types/stats
 * @desc    Get fault type usage statistics
 * @access  Managers
 */
router.get(
  '/fault-types/stats',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.getFaultTypeStats
);

/**
 * @route   GET /api/repair-history/fault-types
 * @desc    Get all fault types
 * @access  Managers
 */
router.get(
  '/fault-types',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.getFaultTypes
);

/**
 * @route   POST /api/repair-history/fault-types
 * @desc    Create a new fault type
 * @access  Admins
 */
router.post(
  '/fault-types',
  authenticateOAuth,
  requireRole(ADMINS),
  RepairHistoryController.createFaultType
);

/**
 * @route   PUT /api/repair-history/fault-types/:faultTypeId
 * @desc    Update fault type
 * @access  Admins
 */
router.put(
  '/fault-types/:faultTypeId',
  authenticateOAuth,
  requireRole(ADMINS),
  RepairHistoryController.updateFaultType
);

/**
 * @route   DELETE /api/repair-history/fault-types/:faultTypeId
 * @desc    Delete fault type (soft delete)
 * @access  Admins
 */
router.delete(
  '/fault-types/:faultTypeId',
  authenticateOAuth,
  requireRole(ADMINS),
  RepairHistoryController.deleteFaultType
);

/**
 * ============================================
 * REPAIR HISTORY ROUTES
 * ============================================
 */

/**
 * @route   GET /api/repair-history/cost-summary
 * @desc    Get repair cost summary
 * @access  Managers
 */
router.get(
  '/cost-summary',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.getRepairCostSummary
);

/**
 * @route   GET /api/repair-history
 * @desc    Get all repairs with filters
 * @access  Managers
 */
router.get(
  '/',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.getAllRepairs
);

/**
 * @route   GET /api/repair-history/:repairId
 * @desc    Get repair entry by ID
 * @access  Managers
 */
router.get(
  '/:repairId',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.getRepairById
);

/**
 * @route   POST /api/repair-history
 * @desc    Create a new repair entry
 * @access  Managers
 */
router.post(
  '/',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.createRepairEntry
);

/**
 * @route   POST /api/repair-history/from-ticket/:ticketId
 * @desc    Create repair entries from ticket closure
 * @access  Managers
 */
router.post(
  '/from-ticket/:ticketId',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.createFromTicketClosure
);

/**
 * @route   PUT /api/repair-history/:repairId
 * @desc    Update repair entry
 * @access  Managers
 */
router.put(
  '/:repairId',
  authenticateOAuth,
  requireRole(MANAGERS),
  RepairHistoryController.updateRepairEntry
);

/**
 * @route   DELETE /api/repair-history/:repairId
 * @desc    Delete repair entry
 * @access  Admins
 */
router.delete(
  '/:repairId',
  authenticateOAuth,
  requireRole(ADMINS),
  RepairHistoryController.deleteRepairEntry
);

module.exports = router;
