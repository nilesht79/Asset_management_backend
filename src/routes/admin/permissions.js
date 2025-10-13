/**
 * SUPERADMIN PERMISSION CONTROL PANEL API
 * Complete API for managing the permission system
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { requireSuperAdmin, requireAdmin, clearPermissionCache } = require('../../middleware/permissions');
const { validateRequest } = require('../../middleware/validation');
const { body, param, query } = require('express-validator');
const permissionService = require('../../services/permissionService');
const { connectDB, sql } = require('../../config/database');

// =====================================================
// PERMISSION CATEGORIES
// =====================================================

/**
 * GET /admin/permissions/categories
 * Get all permission categories with their permissions
 */
router.get('/categories',
  authenticateToken,
  requireAdmin(),
  async (req, res) => {
    try {
      const categorized = await permissionService.getPermissionsByCategory();

      res.json({
        success: true,
        data: categorized,
        message: 'Permission categories retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching permission categories:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch permission categories',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * GET /admin/permissions/all
 * Get all available permissions (flat list)
 */
router.get('/all',
  authenticateToken,
  requireAdmin(),
  async (req, res) => {
    try {
      const permissions = await permissionService.getAllPermissions();

      res.json({
        success: true,
        data: permissions,
        count: permissions.length,
        message: 'All permissions retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching all permissions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch permissions',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// =====================================================
// ROLE TEMPLATES & PERMISSIONS
// =====================================================

/**
 * GET /admin/permissions/roles
 * Get all role templates with their permissions and statistics
 */
router.get('/roles',
  authenticateToken,
  requireSuperAdmin(),
  async (req, res) => {
    try {
      const pool = await connectDB();

      // Get all roles with user counts
      const rolesResult = await pool.request().query(`
        SELECT
          rt.role_template_id,
          rt.role_name,
          rt.display_name,
          rt.description,
          rt.hierarchy_level,
          rt.is_system_role,
          COUNT(DISTINCT um.user_id) as user_count,
          COUNT(DISTINCT rp.permission_id) as permission_count
        FROM ROLE_TEMPLATES rt
        LEFT JOIN USER_MASTER um ON rt.role_name = um.role AND um.is_active = 1
        LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id
        WHERE rt.is_active = 1
        GROUP BY rt.role_template_id, rt.role_name, rt.display_name, rt.description, rt.hierarchy_level, rt.is_system_role
        ORDER BY rt.hierarchy_level DESC
      `);

      // Get permissions for each role
      const roles = await Promise.all(rolesResult.recordset.map(async (role) => {
        const permissions = await permissionService.getRolePermissions(role.role_name);

        return {
          id: role.role_template_id,
          key: role.role_name,
          name: role.display_name,
          description: role.description,
          hierarchy: role.hierarchy_level,
          isSystemRole: role.is_system_role,
          userCount: role.user_count,
          permissionCount: role.permission_count,
          permissions: permissions,
          canModify: role.role_name !== 'superadmin' // Superadmin role cannot be modified
        };
      }));

      res.json({
        success: true,
        data: roles,
        meta: {
          totalRoles: roles.length,
          totalUsers: roles.reduce((sum, r) => sum + r.userCount, 0),
          editableRoles: roles.filter(r => r.canModify).length
        },
        message: 'Role templates retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching role templates:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch role templates',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * GET /admin/permissions/roles/:roleName
 * Get specific role template with detailed permissions
 */
router.get('/roles/:roleName',
  authenticateToken,
  requireSuperAdmin(),
  [param('roleName').notEmpty().withMessage('Role name is required')],
  validateRequest,
  async (req, res) => {
    try {
      const { roleName } = req.params;
      const pool = await connectDB();

      // Get role info
      const roleResult = await pool.request()
        .input('roleName', sql.VarChar(50), roleName)
        .query(`
          SELECT
            rt.role_template_id,
            rt.role_name,
            rt.display_name,
            rt.description,
            rt.hierarchy_level,
            rt.is_system_role,
            COUNT(DISTINCT um.user_id) as user_count
          FROM ROLE_TEMPLATES rt
          LEFT JOIN USER_MASTER um ON rt.role_name = um.role AND um.is_active = 1
          WHERE rt.role_name = @roleName AND rt.is_active = 1
          GROUP BY rt.role_template_id, rt.role_name, rt.display_name, rt.description, rt.hierarchy_level, rt.is_system_role
        `);

      if (roleResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Role not found: ${roleName}`
        });
      }

      const role = roleResult.recordset[0];
      const permissions = await permissionService.getRolePermissions(roleName);

      res.json({
        success: true,
        data: {
          id: role.role_template_id,
          key: role.role_name,
          name: role.display_name,
          description: role.description,
          hierarchy: role.hierarchy_level,
          isSystemRole: role.is_system_role,
          userCount: role.user_count,
          permissions: permissions,
          canModify: role.role_name !== 'superadmin'
        },
        message: 'Role template retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching role template:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch role template',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * PUT /admin/permissions/roles/:roleName
 * Update role template permissions (SuperAdmin only)
 */
router.put('/roles/:roleName',
  authenticateToken,
  requireSuperAdmin(),
  [
    param('roleName').notEmpty().withMessage('Role name is required'),
    body('permissions').isArray().withMessage('Permissions must be an array'),
    body('permissions.*').isString().withMessage('Each permission must be a string'),
    body('reason').optional({ nullable: true }).isString().withMessage('Reason must be a string')
  ],
  validateRequest,
  async (req, res) => {
    console.log('📝 UPDATE ROLE PERMISSIONS REQUEST:');
    console.log('   Role:', req.params.roleName);
    console.log('   Body:', JSON.stringify(req.body, null, 2));
    console.log('   Permissions type:', typeof req.body.permissions);
    console.log('   Permissions is array:', Array.isArray(req.body.permissions));

    try {
      const { roleName } = req.params;
      const { permissions, reason } = req.body;
      const adminUserId = req.oauth.user.id;

      // Validate permissions exist
      const allPermissions = await permissionService.getAllPermissions();
      const validPermissionKeys = allPermissions.map(p => p.key);
      const invalidPermissions = permissions.filter(p => !validPermissionKeys.includes(p));

      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid permissions provided',
          invalidPermissions
        });
      }

      // Update role permissions
      await permissionService.updateRolePermissions(roleName, permissions, adminUserId);

      res.json({
        success: true,
        data: {
          roleName,
          permissions,
          updatedAt: new Date().toISOString()
        },
        message: `Role ${roleName} permissions updated successfully`
      });
    } catch (error) {
      console.error('Error updating role permissions:', error);

      if (error.message.includes('Cannot modify superadmin')) {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to update role permissions',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// =====================================================
// USER PERMISSIONS
// =====================================================

/**
 * GET /admin/permissions/users/:userId
 * Get user's effective permissions (role + custom)
 */
router.get('/users/:userId',
  authenticateToken,
  requireAdmin(),
  [param('userId').isUUID().withMessage('Valid user ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const pool = await connectDB();

      // Get user info
      const userResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT
            user_id,
            first_name,
            last_name,
            email,
            role,
            is_active,
            has_custom_permissions
          FROM USER_MASTER
          WHERE user_id = @userId
        `);

      if (userResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const user = userResult.recordset[0];

      // Get effective permissions
      const effectivePermissions = await permissionService.getUserEffectivePermissions(userId);

      // Get role default permissions
      const rolePermissions = await permissionService.getRolePermissions(user.role);

      // Get custom permissions
      const customPermissions = await permissionService.getUserCustomPermissions(userId);

      res.json({
        success: true,
        data: {
          user: {
            id: user.user_id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
            role: user.role,
            isActive: user.is_active,
            hasCustomPermissions: user.has_custom_permissions
          },
          permissions: {
            effective: effectivePermissions,
            roleDefault: rolePermissions,
            customGranted: customPermissions.granted,
            customRevoked: customPermissions.revoked
          }
        },
        message: 'User permissions retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user permissions',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * POST /admin/permissions/users/:userId/grant
 * Grant custom permission to a user
 */
router.post('/users/:userId/grant',
  authenticateToken,
  requireSuperAdmin(),
  [
    param('userId').isUUID().withMessage('Valid user ID required'),
    body('permissionKey').notEmpty().isString().withMessage('Permission key is required'),
    body('reason').optional({ nullable: true }).isString().withMessage('Reason must be a string'),
    body('expiresAt').optional({ nullable: true }).isISO8601().withMessage('Expires at must be a valid date')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { permissionKey, reason, expiresAt } = req.body;
      const adminUserId = req.oauth.user.id;

      const expiryDate = expiresAt ? new Date(expiresAt) : null;

      const result = await permissionService.grantUserPermission(
        userId,
        permissionKey,
        adminUserId,
        reason,
        expiryDate
      );

      res.json({
        success: true,
        data: {
          userId,
          permissionKey,
          grantedBy: adminUserId,
          reason,
          expiresAt: expiryDate
        },
        message: result.message
      });
    } catch (error) {
      console.error('Error granting user permission:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to grant permission',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * POST /admin/permissions/users/:userId/revoke
 * Revoke custom permission from a user
 */
router.post('/users/:userId/revoke',
  authenticateToken,
  requireSuperAdmin(),
  [
    param('userId').isUUID().withMessage('Valid user ID required'),
    body('permissionKey').notEmpty().isString().withMessage('Permission key is required'),
    body('reason').optional({ nullable: true }).isString().withMessage('Reason must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { permissionKey, reason } = req.body;
      const adminUserId = req.oauth.user.id;

      const result = await permissionService.revokeUserPermission(
        userId,
        permissionKey,
        adminUserId,
        reason
      );

      res.json({
        success: true,
        data: {
          userId,
          permissionKey,
          revokedBy: adminUserId,
          reason
        },
        message: result.message
      });
    } catch (error) {
      console.error('Error revoking user permission:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to revoke permission',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * DELETE /admin/permissions/users/:userId/custom
 * Remove all custom permissions from a user (reset to role defaults)
 */
router.delete('/users/:userId/custom',
  authenticateToken,
  requireSuperAdmin(),
  [param('userId').isUUID().withMessage('Valid user ID required')],
  validateRequest,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const pool = await connectDB();

      // Delete all custom permissions
      await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query('DELETE FROM USER_CUSTOM_PERMISSIONS WHERE user_id = @userId');

      // Update flag
      await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query('UPDATE USER_MASTER SET has_custom_permissions = 0 WHERE user_id = @userId');

      // Clear cache
      clearPermissionCache(userId);

      res.json({
        success: true,
        message: 'All custom permissions removed. User now has role default permissions only.'
      });
    } catch (error) {
      console.error('Error removing custom permissions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove custom permissions',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// =====================================================
// PERMISSION AUDIT & ANALYTICS
// =====================================================

/**
 * GET /admin/permissions/audit
 * Get permission audit logs
 */
router.get('/audit',
  authenticateToken,
  requireSuperAdmin(),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('targetType').optional().isString().withMessage('Target type must be a string'),
    query('targetId').optional().isUUID().withMessage('Target ID must be a valid UUID'),
    query('performedBy').optional().isUUID().withMessage('Performed by must be a valid UUID'),
    query('actionType').optional().isString().withMessage('Action type must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const filters = {
        targetType: req.query.targetType,
        targetId: req.query.targetId,
        performedBy: req.query.performedBy,
        actionType: req.query.actionType
      };

      const result = await permissionService.getAuditLogs(filters, page, limit);

      res.json({
        success: true,
        data: result.logs,
        pagination: result.pagination,
        message: 'Audit logs retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch audit logs',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * GET /admin/permissions/analytics/role-distribution
 * Get analytics on role distribution and usage
 */
router.get('/analytics/role-distribution',
  authenticateToken,
  requireSuperAdmin(),
  async (req, res) => {
    try {
      const pool = await connectDB();

      const result = await pool.request().query(`
        SELECT
          um.role,
          COUNT(*) as user_count,
          SUM(CASE WHEN um.has_custom_permissions = 1 THEN 1 ELSE 0 END) as users_with_custom_permissions,
          SUM(CASE WHEN um.is_active = 1 THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN um.is_active = 0 THEN 1 ELSE 0 END) as inactive_users
        FROM USER_MASTER um
        GROUP BY um.role
        ORDER BY user_count DESC
      `);

      res.json({
        success: true,
        data: result.recordset.map(row => ({
          role: row.role,
          totalUsers: row.user_count,
          activeUsers: row.active_users,
          inactiveUsers: row.inactive_users,
          usersWithCustomPermissions: row.users_with_custom_permissions
        })),
        message: 'Role distribution analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching role distribution analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch analytics',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * POST /admin/permissions/cache/clear
 * Clear permission caches (SuperAdmin only)
 */
router.post('/cache/clear',
  authenticateToken,
  requireSuperAdmin(),
  [
    body('userId').optional().isUUID().withMessage('User ID must be a valid UUID'),
    body('roleName').optional().isString().withMessage('Role name must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { userId, roleName } = req.body;

      if (userId) {
        clearPermissionCache(userId);
      } else if (roleName) {
        permissionService.clearRoleCache(roleName);
      } else {
        clearPermissionCache(); // Clear all
      }

      res.json({
        success: true,
        message: 'Permission cache cleared successfully'
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to clear cache',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

module.exports = router;
