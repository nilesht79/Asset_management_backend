const AssetMovementModel = require('../models/assetMovement');
const { asyncHandler } = require('../middleware/error-handler');

/**
 * Asset Movement Controller
 * Handles HTTP requests for asset movement tracking
 */

/**
 * @route   GET /api/v1/assets/movements/recent
 * @desc    Get recent asset movements across all assets
 * @access  Authenticated users
 */
exports.getRecentMovements = asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const movements = await AssetMovementModel.getRecentMovements({
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.status(200).json({
    success: true,
    data: movements,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: movements.length
    }
  });
});

/**
 * @route   GET /api/v1/assets/:assetId/movements
 * @desc    Get movement history for a specific asset
 * @access  Authenticated users
 */
exports.getAssetMovementHistory = asyncHandler(async (req, res) => {
  const { assetId } = req.params;
  const { limit = 100, offset = 0, orderBy = 'movement_date DESC' } = req.query;

  const movements = await AssetMovementModel.getAssetMovementHistory(assetId, {
    limit: parseInt(limit),
    offset: parseInt(offset),
    orderBy
  });

  res.status(200).json({
    success: true,
    data: movements,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: movements.length
    }
  });
});

/**
 * @route   GET /api/v1/assets/:assetId/movements/current
 * @desc    Get current assignment for an asset
 * @access  Authenticated users
 */
exports.getCurrentAssignment = asyncHandler(async (req, res) => {
  const { assetId } = req.params;

  const currentAssignment = await AssetMovementModel.getCurrentAssignment(assetId);

  if (!currentAssignment) {
    return res.status(404).json({
      success: false,
      message: 'No movement history found for this asset'
    });
  }

  res.status(200).json({
    success: true,
    data: currentAssignment
  });
});

/**
 * @route   GET /api/v1/users/:userId/movements
 * @desc    Get movement history for a specific user (their assignments)
 * @access  Authenticated users (can view own, admins can view all)
 */
exports.getUserMovementHistory = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 100, offset = 0 } = req.query;

  // Authorization check: users can only view their own, admins can view all
  if (req.user.user_id !== userId && !['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'You do not have permission to view this user\'s movement history'
    });
  }

  const movements = await AssetMovementModel.getUserMovementHistory(userId, {
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.status(200).json({
    success: true,
    data: movements,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: movements.length
    }
  });
});

/**
 * @route   GET /api/v1/locations/:locationId/movements
 * @desc    Get movement history for a specific location
 * @access  Authenticated users
 */
exports.getLocationMovementHistory = asyncHandler(async (req, res) => {
  const { locationId } = req.params;
  const { limit = 100, offset = 0 } = req.query;

  const movements = await AssetMovementModel.getLocationMovementHistory(locationId, {
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.status(200).json({
    success: true,
    data: movements,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: movements.length
    }
  });
});

/**
 * @route   POST /api/v1/assets/:assetId/movements
 * @desc    Create a new movement record (manual entry or from asset update)
 * @access  Admin only
 */
exports.createMovement = asyncHandler(async (req, res) => {
  const { assetId } = req.params;
  const {
    assignedTo,
    locationId,
    movementType,
    status,
    previousUserId,
    previousLocationId,
    movementDate,
    reason,
    notes
  } = req.body;

  // Validation
  if (!movementType || !status) {
    return res.status(400).json({
      success: false,
      message: 'Movement type and status are required'
    });
  }

  const movementData = {
    assetId,
    assignedTo,
    locationId,
    movementType,
    status,
    previousUserId,
    previousLocationId,
    movementDate: movementDate ? new Date(movementDate) : new Date(),
    reason,
    notes
  };

  const movement = await AssetMovementModel.createMovement(
    movementData,
    req.user.user_id
  );

  res.status(201).json({
    success: true,
    message: 'Movement record created successfully',
    data: movement
  });
});

/**
 * @route   GET /api/v1/assets/movements/statistics
 * @desc    Get movement statistics for dashboard
 * @access  Admin only
 */
exports.getMovementStatistics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filters = {};
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  const statistics = await AssetMovementModel.getMovementStatistics(filters);

  res.status(200).json({
    success: true,
    data: statistics
  });
});

/**
 * Helper function to log asset movement when asset assignment changes
 * This can be called from the asset update controller
 *
 * @param {object} assetData - Current asset data
 * @param {object} previousData - Previous asset data
 * @param {string} performedBy - User ID who made the change
 * @returns {Promise<object>} Created movement record
 */
exports.logAssetAssignmentChange = async (assetData, previousData, performedBy) => {
  try {
    // Determine movement type
    let movementType = 'transferred';
    if (!previousData.assigned_to && assetData.assigned_to) {
      movementType = 'assigned';
    } else if (previousData.assigned_to && !assetData.assigned_to) {
      movementType = 'returned';
    }

    // Check if location changed
    if (previousData.location_id !== assetData.location_id &&
        previousData.assigned_to === assetData.assigned_to) {
      movementType = 'relocated';
    }

    const movementData = {
      assetId: assetData.id,
      assignedTo: assetData.assigned_to,
      locationId: assetData.location_id,
      movementType,
      status: assetData.status,
      previousUserId: previousData.assigned_to,
      previousLocationId: previousData.location_id,
      movementDate: new Date(),
      reason: 'Asset assignment updated',
      notes: null
    };

    return await AssetMovementModel.createMovement(movementData, performedBy);
  } catch (error) {
    console.error('Error logging asset assignment change:', error);
    // Don't throw - movement logging should not break asset updates
    return null;
  }
};
