/**
 * UNIFIED PERMISSION MIDDLEWARE
 * This replaces both rbac.js and dynamic-permissions.js with a single, database-driven system
 */

const { sendForbidden, sendUnauthorized } = require('../utils/response');
const permissionService = require('../services/permissionService');
const { ROLE_HIERARCHY } = require('../config/auth');

/**
 * Middleware to require specific permission(s)
 * @param {string|Array<string>} requiredPermissions - Permission key(s) required
 * @param {string} logic - 'OR' or 'AND' (default: 'OR' for single, 'AND' for multiple)
 * @returns {Function} Express middleware
 */
const requirePermission = (requiredPermissions, logic = null) => {
  return async (req, res, next) => {
    if (!req.oauth || !req.oauth.user) {
      return sendUnauthorized(res, 'Authentication required');
    }

    try {
      const userId = req.oauth.user.id;
      const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

      // Auto-detect logic if not specified
      const useAndLogic = logic === 'AND' || (logic === null && permissions.length === 1);

      let hasAccess = false;

      if (useAndLogic) {
        // AND logic: user must have ALL permissions
        hasAccess = await permissionService.userHasAllPermissions(userId, permissions);
      } else {
        // OR logic: user must have AT LEAST ONE permission
        hasAccess = await permissionService.userHasAnyPermission(userId, permissions);
      }

      if (!hasAccess) {
        return sendForbidden(res, `You do not have permission to perform this action`);
      }

      // Store granted permissions in request for logging
      req.grantedPermissions = permissions;

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return sendForbidden(res, 'Permission validation failed');
    }
  };
};

/**
 * Middleware to require specific role(s)
 * @param {string|Array<string>} requiredRoles - Role name(s) required
 * @returns {Function} Express middleware
 */
const requireRole = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.oauth || !req.oauth.user) {
      return sendUnauthorized(res, 'Authentication required');
    }

    const userRole = req.oauth.user.role;
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

    if (!roles.includes(userRole)) {
      return sendForbidden(res, `Access denied`);
    }

    next();
  };
};

/**
 * Middleware to require minimum role level (hierarchical)
 * @param {string} minimumRole - Minimum role required (e.g., 'admin')
 * @returns {Function} Express middleware
 */
const requireRoleLevel = (minimumRole) => {
  return (req, res, next) => {
    if (!req.oauth || !req.oauth.user) {
      return sendUnauthorized(res, 'Authentication required');
    }

    const userRole = req.oauth.user.role;
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;

    if (userLevel < requiredLevel) {
      return sendForbidden(res, `Access denied`);
    }

    next();
  };
};

/**
 * Dynamic permission middleware - auto-detects required permissions from route
 * This analyzes the HTTP method and route path to determine required permissions
 * @returns {Function} Express middleware
 */
const requireDynamicPermission = () => {
  return async (req, res, next) => {
    if (!req.oauth || !req.oauth.user) {
      return sendUnauthorized(res, 'Authentication required');
    }

    try {
      const userId = req.oauth.user.id;
      const method = req.method.toUpperCase();
      const baseUrl = req.baseUrl || '';
      const path = req.route?.path || req.path;
      const fullPath = req.originalUrl.split('?')[0];

      // Extract resource and action
      const { resource, action } = extractResourceAndAction(method, baseUrl, path, fullPath);

      if (!resource || !action) {
        return sendForbidden(res, `Access denied`);
      }

      // Build possible permission keys
      const possiblePermissions = buildPermissionKeys(resource, action);

      // Check if user has any of the possible permissions (OR logic)
      const hasAccess = await permissionService.userHasAnyPermission(userId, possiblePermissions);

      if (!hasAccess) {
        return sendForbidden(res, `You do not have permission to perform this action`);
      }

      // Store permission info in request
      req.dynamicPermission = {
        resource,
        action,
        possiblePermissions,
        granted: true
      };

      next();
    } catch (error) {
      console.error('Dynamic permission error:', error);
      return sendForbidden(res, 'Permission validation failed');
    }
  };
};

/**
 * Extract resource and action from route information
 * @private
 */
function extractResourceAndAction(method, baseUrl, routePath, fullPath) {
  // Remove leading slashes and split into segments
  const segments = fullPath.replace(/^\//, '').split('/').filter(Boolean);

  // Filter out API version prefixes, UUIDs, and numeric IDs
  const resourceSegments = segments.filter(segment => {
    if (segment === 'api' || /^v\d+$/i.test(segment)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return false;
    if (/^\d+$/.test(segment)) return false;
    return true;
  });

  if (resourceSegments.length === 0) {
    return { resource: null, action: null };
  }

  // Build resource name
  let resource = resourceSegments[0];

  // Handle nested resources (e.g., /masters/oem becomes "masters.oem")
  if (resourceSegments[0] === 'masters' && resourceSegments.length > 1) {
    resource = `masters.${resourceSegments[1]}`;
  } else if (resourceSegments[0] === 'admin' && resourceSegments.length > 1) {
    resource = `admin.${resourceSegments[1]}`;
  }

  // Determine action from method and special path segments
  let action = null;

  // Check for special actions in the path
  if (fullPath.includes('/assign')) action = 'assign';
  else if (fullPath.includes('/unassign')) action = 'assign';
  else if (fullPath.includes('/transfer')) action = 'transfer';
  else if (fullPath.includes('/restore')) action = 'update';
  else if (fullPath.includes('/statistics') || fullPath.includes('/dashboard')) action = 'read';
  else if (fullPath.includes('/export')) action = 'export';
  else if (fullPath.includes('/audit')) action = 'audit';
  else if (fullPath.includes('/generate-form')) action = 'read'; // Generating forms is a read operation
  else if (fullPath.includes('/upload-signature') || fullPath.includes('/upload-signed-form')) action = 'update'; // Uploading is an update operation
  else if (fullPath.includes('/verify-signature') || fullPath.includes('/confirm-functionality')) action = 'update'; // Verification/confirmation is update
  else if (fullPath.includes('/mark-delivered')) action = 'update'; // Mark as delivered (bypass verification)
  else {
    // Standard CRUD mapping
    switch (method) {
      case 'GET':
        action = 'read';
        break;
      case 'POST':
        action = 'create';
        break;
      case 'PUT':
      case 'PATCH':
        action = 'update';
        break;
      case 'DELETE':
        action = 'delete';
        break;
      default:
        action = 'read';
    }
  }

  return { resource, action };
}

/**
 * Build possible permission keys for a resource and action
 * Returns multiple possibilities to support flexible permission models
 * @private
 */
function buildPermissionKeys(resource, action) {
  const permissions = [];

  // Handle nested resources (e.g., "masters.oem")
  if (resource.includes('.')) {
    const [parent, child] = resource.split('.');

    // Specific permission: masters.oem.manage
    permissions.push(`${resource}.manage`);

    // Generic parent permissions
    if (action === 'read' || action === 'export') {
      permissions.push(`${parent}.read`);
    } else if (['create', 'update', 'delete'].includes(action)) {
      permissions.push(`${parent}.write`);
      permissions.push(`${parent}.${action}`);
    }
  } else {
    // Standard resource.action format
    permissions.push(`${resource}.${action}`);

    // Add additional fallback permissions for read-like and modify operations
    if (['create', 'update', 'delete', 'assign', 'transfer'].includes(action)) {
      // Also accept read permission for some operations
      if (action !== 'create') {
        permissions.push(`${resource}.read`);
      }
    } else if (action === 'export' || action === 'audit') {
      // Export and audit should also work with read permission
      permissions.push(`${resource}.read`);
    }
  }

  return [...new Set(permissions)]; // Remove duplicates
}

/**
 * Middleware for SuperAdmin-only routes
 * Convenience wrapper for requireRole('superadmin')
 */
const requireSuperAdmin = () => requireRole('superadmin');

/**
 * Middleware for Admin-level routes (admin or superadmin)
 * Convenience wrapper for requireRoleLevel('admin')
 */
const requireAdmin = () => requireRoleLevel('admin');

/**
 * Clear permission caches (call after permission updates)
 * @param {string} userId - Optional user ID to clear specific user cache
 */
const clearPermissionCache = (userId = null) => {
  if (userId) {
    permissionService.clearUserCache(userId);
  } else {
    permissionService.clearAllCaches();
  }
};

/**
 * Middleware to check if user can manage another user
 * User must have higher role hierarchy level than target user
 */
const requireHigherRole = () => {
  return async (req, res, next) => {
    if (!req.oauth || !req.oauth.user) {
      return sendUnauthorized(res, 'Authentication required');
    }

    try {
      const currentUserRole = req.oauth.user.role;
      const targetUserId = req.params.userId || req.params.id || req.body.userId;

      if (!targetUserId) {
        return next(); // No target user specified
      }

      // Get target user's role
      const { connectDB, sql } = require('../config/database');
      const pool = await connectDB();
      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, targetUserId)
        .query('SELECT role FROM USER_MASTER WHERE user_id = @userId');

      if (result.recordset.length === 0) {
        return sendForbidden(res, 'Target user not found');
      }

      const targetUserRole = result.recordset[0].role;

      const currentLevel = ROLE_HIERARCHY[currentUserRole] || 0;
      const targetLevel = ROLE_HIERARCHY[targetUserRole] || 0;

      if (currentLevel <= targetLevel) {
        return sendForbidden(res, `Access denied`);
      }

      next();
    } catch (error) {
      console.error('Role hierarchy check error:', error);
      return sendForbidden(res, 'Role validation failed');
    }
  };
};

/**
 * Middleware to allow access if user is self OR has one of the required roles
 * @param {string|Array<string>} allowedRoles - Role name(s) that are allowed
 * @param {string} userIdField - Field name containing the user ID (default: 'id')
 * @returns {Function} Express middleware
 */
const requireSelfOrRole = (allowedRoles, userIdField = 'id') => {
  return (req, res, next) => {
    if (!req.oauth || !req.oauth.user) {
      return sendUnauthorized(res, 'Authentication required');
    }

    const currentUserId = req.oauth.user.id;
    const currentUserRole = req.oauth.user.role;
    const targetUserId = req.params[userIdField] || req.body[userIdField];

    // Check if accessing own data
    const isSelf = currentUserId === targetUserId;

    // Check if has allowed role
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const hasAllowedRole = roles.includes(currentUserRole);

    if (isSelf || hasAllowedRole) {
      return next();
    }

    return sendForbidden(res, `Access denied`);
  };
};

module.exports = {
  // Main permission middleware
  requirePermission,
  requireDynamicPermission,

  // Role-based middleware
  requireRole,
  requireRoleLevel,
  requireSuperAdmin,
  requireAdmin,
  requireHigherRole,
  requireSelfOrRole,

  // Cache management
  clearPermissionCache,

  // Export service for direct access if needed
  permissionService
};
