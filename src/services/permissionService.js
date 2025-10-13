/**
 * PERMISSION SERVICE
 * Centralized service for all permission-related operations
 * This service interacts with the database to provide dynamic permission management
 */

const { connectDB, sql } = require('../config/database');

class PermissionService {
  constructor() {
    // In-memory cache for performance (5 minute TTL)
    this.userPermissionCache = new Map();
    this.rolePermissionCache = new Map();
    this.allPermissionsCache = null;
    this.allPermissionsCacheExpiry = null;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get all available permissions in the system
   * @returns {Promise<Array>} Array of all permission objects
   */
  async getAllPermissions() {
    // Check cache first
    if (this.allPermissionsCache && this.allPermissionsCacheExpiry > Date.now()) {
      return this.allPermissionsCache;
    }

    try {
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT
          p.permission_id,
          p.permission_key,
          p.permission_name,
          p.description,
          p.resource_type,
          p.action_type,
          p.is_system,
          p.display_order,
          pc.category_id,
          pc.category_key,
          pc.category_name,
          pc.display_order as category_display_order
        FROM PERMISSIONS p
        LEFT JOIN PERMISSION_CATEGORIES pc ON p.category_id = pc.category_id
        WHERE p.is_active = 1 AND (pc.is_active = 1 OR pc.is_active IS NULL)
        ORDER BY pc.display_order, p.display_order
      `);

      const permissions = result.recordset.map(row => ({
        id: row.permission_id,
        key: row.permission_key,
        name: row.permission_name,
        description: row.description,
        resourceType: row.resource_type,
        actionType: row.action_type,
        isSystem: row.is_system,
        displayOrder: row.display_order,
        category: {
          id: row.category_id,
          key: row.category_key,
          name: row.category_name,
          displayOrder: row.category_display_order
        }
      }));

      // Cache for 10 minutes
      this.allPermissionsCache = permissions;
      this.allPermissionsCacheExpiry = Date.now() + (10 * 60 * 1000);

      return permissions;
    } catch (error) {
      console.error('Error fetching all permissions:', error);
      throw new Error('Failed to fetch permissions');
    }
  }

  /**
   * Get permissions grouped by category
   * @returns {Promise<Object>} Permissions organized by category
   */
  async getPermissionsByCategory() {
    const permissions = await this.getAllPermissions();

    const categorized = {};
    permissions.forEach(permission => {
      const categoryKey = permission.category.key || 'uncategorized';
      if (!categorized[categoryKey]) {
        categorized[categoryKey] = {
          categoryId: permission.category.id,
          categoryName: permission.category.name,
          categoryKey: categoryKey,
          permissions: []
        };
      }
      categorized[categoryKey].permissions.push(permission);
    });

    return categorized;
  }

  /**
   * Get default permissions for a role from database
   * @param {string} roleName - Role name (e.g., 'admin', 'superadmin')
   * @returns {Promise<Array>} Array of permission keys
   */
  async getRolePermissions(roleName) {
    // Check cache
    const cacheKey = `role_${roleName}`;
    if (this.rolePermissionCache.has(cacheKey)) {
      const cached = this.rolePermissionCache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.permissions;
      }
      this.rolePermissionCache.delete(cacheKey);
    }

    try {
      const pool = await connectDB();
      const result = await pool.request()
        .input('roleName', sql.VarChar(50), roleName)
        .query(`
          SELECT p.permission_key
          FROM ROLE_PERMISSIONS rp
          INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
          INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
          WHERE rt.role_name = @roleName
            AND rt.is_active = 1
            AND p.is_active = 1
        `);

      const permissions = result.recordset.map(row => row.permission_key);

      // Cache for 5 minutes
      this.rolePermissionCache.set(cacheKey, {
        permissions,
        expires: Date.now() + this.CACHE_TTL
      });

      return permissions;
    } catch (error) {
      console.error(`Error fetching permissions for role ${roleName}:`, error);
      return [];
    }
  }

  /**
   * Get effective permissions for a user (role permissions + custom permissions)
   * @param {string} userId - User UUID
   * @returns {Promise<Array>} Array of permission keys
   */
  async getUserEffectivePermissions(userId) {
    // Check cache
    const cacheKey = `user_${userId}`;
    if (this.userPermissionCache.has(cacheKey)) {
      const cached = this.userPermissionCache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.permissions;
      }
      this.userPermissionCache.delete(cacheKey);
    }

    try {
      const pool = await connectDB();

      // Get user's role
      const userResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query('SELECT role FROM USER_MASTER WHERE user_id = @userId AND is_active = 1');

      if (userResult.recordset.length === 0) {
        console.warn(`User not found or inactive: ${userId}`);
        return [];
      }

      const userRole = userResult.recordset[0].role;

      // Get role-based permissions
      const rolePermissions = await this.getRolePermissions(userRole);

      // Get custom user permissions (both granted and revoked)
      const customResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT p.permission_key, ucp.is_granted, ucp.expires_at
          FROM user_custom_permissions ucp
          INNER JOIN permissions p ON ucp.permission_id = p.permission_id
          WHERE ucp.user_id = @userId
            AND p.is_active = 1
            AND (ucp.expires_at IS NULL OR ucp.expires_at > GETUTCDATE())
        `);

      // Build effective permissions set
      const effectivePermissions = new Set(rolePermissions);

      // Apply custom permissions (granted = add, revoked = remove)
      customResult.recordset.forEach(row => {
        if (row.is_granted) {
          effectivePermissions.add(row.permission_key);
        } else {
          effectivePermissions.delete(row.permission_key);
        }
      });

      const permissions = Array.from(effectivePermissions);

      // Cache for 5 minutes
      this.userPermissionCache.set(cacheKey, {
        permissions,
        expires: Date.now() + this.CACHE_TTL
      });

      return permissions;
    } catch (error) {
      console.error(`Error fetching effective permissions for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Check if user has a specific permission
   * @param {string} userId - User UUID
   * @param {string} permissionKey - Permission key (e.g., 'users.create')
   * @returns {Promise<boolean>}
   */
  async userHasPermission(userId, permissionKey) {
    const permissions = await this.getUserEffectivePermissions(userId);
    return permissions.includes(permissionKey);
  }

  /**
   * Check if user has any of the specified permissions (OR logic)
   * @param {string} userId - User UUID
   * @param {Array<string>} permissionKeys - Array of permission keys
   * @returns {Promise<boolean>}
   */
  async userHasAnyPermission(userId, permissionKeys) {
    const permissions = await this.getUserEffectivePermissions(userId);
    return permissionKeys.some(key => permissions.includes(key));
  }

  /**
   * Check if user has all of the specified permissions (AND logic)
   * @param {string} userId - User UUID
   * @param {Array<string>} permissionKeys - Array of permission keys
   * @returns {Promise<boolean>}
   */
  async userHasAllPermissions(userId, permissionKeys) {
    const permissions = await this.getUserEffectivePermissions(userId);
    return permissionKeys.every(key => permissions.includes(key));
  }

  /**
   * Grant custom permission to a user
   * @param {string} userId - User UUID
   * @param {string} permissionKey - Permission key
   * @param {string} grantedBy - Admin user UUID
   * @param {string} reason - Reason for granting
   * @param {Date} expiresAt - Optional expiration date
   * @returns {Promise<Object>}
   */
  async grantUserPermission(userId, permissionKey, grantedBy, reason = null, expiresAt = null) {
    try {
      const pool = await connectDB();

      // Get permission ID
      const permResult = await pool.request()
        .input('permissionKey', sql.VarChar(200), permissionKey)
        .query('SELECT permission_id FROM PERMISSIONS WHERE permission_key = @permissionKey AND is_active = 1');

      if (permResult.recordset.length === 0) {
        throw new Error(`Permission not found: ${permissionKey}`);
      }

      const permissionId = permResult.recordset[0].permission_id;

      // Insert or update custom permission
      await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('permissionId', sql.UniqueIdentifier, permissionId)
        .input('isGranted', sql.Bit, 1)
        .input('grantedBy', sql.UniqueIdentifier, grantedBy)
        .input('reason', sql.NVarChar(500), reason)
        .input('expiresAt', sql.DateTime2, expiresAt)
        .query(`
          MERGE USER_CUSTOM_PERMISSIONS AS target
          USING (SELECT @userId AS user_id, @permissionId AS permission_id) AS source
          ON target.user_id = source.user_id AND target.permission_id = source.permission_id
          WHEN MATCHED THEN
            UPDATE SET
              is_granted = @isGranted,
              granted_by = @grantedBy,
              granted_at = GETUTCDATE(),
              reason = @reason,
              expires_at = @expiresAt
          WHEN NOT MATCHED THEN
            INSERT (user_id, permission_id, is_granted, granted_by, granted_at, reason, expires_at)
            VALUES (@userId, @permissionId, @isGranted, @grantedBy, GETUTCDATE(), @reason, @expiresAt);
        `);

      // Update has_custom_permissions flag
      await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query('UPDATE USER_MASTER SET has_custom_permissions = 1 WHERE user_id = @userId');

      // Clear cache
      this.clearUserCache(userId);

      // Log audit trail
      await this.logPermissionChange('GRANT', 'USER', userId, permissionId, grantedBy, null, permissionKey, reason);

      return { success: true, message: `Permission ${permissionKey} granted to user` };
    } catch (error) {
      console.error('Error granting user permission:', error);
      throw error;
    }
  }

  /**
   * Revoke custom permission from a user
   * @param {string} userId - User UUID
   * @param {string} permissionKey - Permission key
   * @param {string} revokedBy - Admin user UUID
   * @param {string} reason - Reason for revoking
   * @returns {Promise<Object>}
   */
  async revokeUserPermission(userId, permissionKey, revokedBy, reason = null) {
    try {
      const pool = await connectDB();

      // Get permission ID
      const permResult = await pool.request()
        .input('permissionKey', sql.VarChar(200), permissionKey)
        .query('SELECT permission_id FROM PERMISSIONS WHERE permission_key = @permissionKey AND is_active = 1');

      if (permResult.recordset.length === 0) {
        throw new Error(`Permission not found: ${permissionKey}`);
      }

      const permissionId = permResult.recordset[0].permission_id;

      // Mark as revoked (is_granted = 0)
      await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('permissionId', sql.UniqueIdentifier, permissionId)
        .input('isGranted', sql.Bit, 0)
        .input('revokedBy', sql.UniqueIdentifier, revokedBy)
        .input('reason', sql.NVarChar(500), reason)
        .query(`
          MERGE USER_CUSTOM_PERMISSIONS AS target
          USING (SELECT @userId AS user_id, @permissionId AS permission_id) AS source
          ON target.user_id = source.user_id AND target.permission_id = source.permission_id
          WHEN MATCHED THEN
            UPDATE SET
              is_granted = @isGranted,
              granted_by = @revokedBy,
              granted_at = GETUTCDATE(),
              reason = @reason
          WHEN NOT MATCHED THEN
            INSERT (user_id, permission_id, is_granted, granted_by, granted_at, reason)
            VALUES (@userId, @permissionId, @isGranted, @revokedBy, GETUTCDATE(), @reason);
        `);

      // Clear cache
      this.clearUserCache(userId);

      // Log audit trail
      await this.logPermissionChange('REVOKE', 'USER', userId, permissionId, revokedBy, permissionKey, null, reason);

      return { success: true, message: `Permission ${permissionKey} revoked from user` };
    } catch (error) {
      console.error('Error revoking user permission:', error);
      throw error;
    }
  }

  /**
   * Update role template permissions (SuperAdmin only)
   * @param {string} roleName - Role name
   * @param {Array<string>} permissionKeys - Array of permission keys
   * @param {string} updatedBy - Admin user UUID
   * @returns {Promise<Object>}
   */
  async updateRolePermissions(roleName, permissionKeys, updatedBy) {
    try {
      const pool = await connectDB();
      const transaction = pool.transaction();

      await transaction.begin();

      try {
        // Get role template ID
        const roleResult = await transaction.request()
          .input('roleName', sql.VarChar(50), roleName)
          .query('SELECT role_template_id, is_system_role FROM ROLE_TEMPLATES WHERE role_name = @roleName AND is_active = 1');

        if (roleResult.recordset.length === 0) {
          throw new Error(`Role not found: ${roleName}`);
        }

        const roleTemplateId = roleResult.recordset[0].role_template_id;
        const isSystemRole = roleResult.recordset[0].is_system_role;

        // Prevent modification of superadmin role
        if (roleName === 'superadmin') {
          throw new Error('Cannot modify superadmin role permissions');
        }

        // *** GET EXISTING PERMISSIONS BEFORE DELETING ***
        const existingPermsResult = await transaction.request()
          .input('roleTemplateId', sql.UniqueIdentifier, roleTemplateId)
          .query(`
            SELECT p.permission_key
            FROM ROLE_PERMISSIONS rp
            JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
            WHERE rp.role_template_id = @roleTemplateId
          `);

        const oldPermissions = existingPermsResult.recordset.map(row => row.permission_key);

        // Delete existing role permissions
        await transaction.request()
          .input('roleTemplateId', sql.UniqueIdentifier, roleTemplateId)
          .query('DELETE FROM ROLE_PERMISSIONS WHERE role_template_id = @roleTemplateId');

        // Insert new permissions
        for (const permissionKey of permissionKeys) {
          const permResult = await transaction.request()
            .input('permissionKey', sql.VarChar(200), permissionKey)
            .query('SELECT permission_id FROM PERMISSIONS WHERE permission_key = @permissionKey AND is_active = 1');

          if (permResult.recordset.length > 0) {
            await transaction.request()
              .input('roleTemplateId', sql.UniqueIdentifier, roleTemplateId)
              .input('permissionId', sql.UniqueIdentifier, permResult.recordset[0].permission_id)
              .input('grantedBy', sql.UniqueIdentifier, updatedBy)
              .query(`
                INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id, granted_by, granted_at)
                VALUES (@roleTemplateId, @permissionId, @grantedBy, GETUTCDATE())
              `);
          }
        }

        // Update role template timestamp
        await transaction.request()
          .input('roleTemplateId', sql.UniqueIdentifier, roleTemplateId)
          .input('updatedBy', sql.UniqueIdentifier, updatedBy)
          .query('UPDATE ROLE_TEMPLATES SET updated_at = GETUTCDATE(), updated_by = @updatedBy WHERE role_template_id = @roleTemplateId');

        await transaction.commit();

        // Clear all caches for this role
        this.clearRoleCache(roleName);

        // Log audit trail with old and new values
        await this.logPermissionChange(
          'ROLE_UPDATE',
          'ROLE',
          roleTemplateId, // Store roleTemplateId (UUID)
          null,
          updatedBy,
          JSON.stringify(oldPermissions), // OLD permissions
          JSON.stringify(permissionKeys),  // NEW permissions
          `Updated ${roleName} permissions`
        );

        return { success: true, message: `Role ${roleName} permissions updated successfully` };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error updating role permissions:', error);
      throw error;
    }
  }

  /**
   * Get user's custom permissions
   * @param {string} userId - User UUID
   * @returns {Promise<Object>}
   */
  async getUserCustomPermissions(userId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT
            p.permission_key,
            p.permission_name,
            ucp.is_granted,
            ucp.granted_at,
            ucp.expires_at,
            ucp.reason,
            u.first_name + ' ' + u.last_name as granted_by_name
          FROM USER_CUSTOM_PERMISSIONS ucp
          INNER JOIN PERMISSIONS p ON ucp.permission_id = p.permission_id
          LEFT JOIN USER_MASTER u ON ucp.granted_by = u.user_id
          WHERE ucp.user_id = @userId
            AND p.is_active = 1
          ORDER BY ucp.granted_at DESC
        `);

      const granted = [];
      const revoked = [];

      result.recordset.forEach(row => {
        const permission = {
          key: row.permission_key,
          name: row.permission_name,
          grantedAt: row.granted_at,
          grantedBy: row.granted_by_name,
          expiresAt: row.expires_at,
          reason: row.reason
        };

        if (row.is_granted) {
          granted.push(permission);
        } else {
          revoked.push(permission);
        }
      });

      return { granted, revoked };
    } catch (error) {
      console.error('Error fetching user custom permissions:', error);
      throw error;
    }
  }

  /**
   * Log permission change to audit trail
   * @private
   */
  async logPermissionChange(actionType, targetType, targetId, permissionId, performedBy, oldValue, newValue, reason) {
    try {
      const pool = await connectDB();

      await pool.request()
        .input('actionType', sql.VarChar(50), actionType)
        .input('targetType', sql.VarChar(50), targetType)
        .input('targetId', sql.UniqueIdentifier, targetId)
        .input('permissionId', sql.UniqueIdentifier, permissionId)
        .input('oldValue', sql.NVarChar(sql.MAX), oldValue)
        .input('newValue', sql.NVarChar(sql.MAX), newValue)
        .input('performedBy', sql.UniqueIdentifier, performedBy)
        .input('reason', sql.NVarChar(500), reason)
        .query(`
          INSERT INTO PERMISSION_AUDIT_LOG
          (action_type, target_type, target_id, permission_id, old_value, new_value, performed_by, reason)
          VALUES
          (@actionType, @targetType, @targetId, @permissionId, @oldValue, @newValue, @performedBy, @reason)
        `);
    } catch (error) {
      console.error('Error logging permission change:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }

  /**
   * Clear user permission cache
   * @param {string} userId - User UUID (optional - clears all if not provided)
   */
  clearUserCache(userId = null) {
    if (userId) {
      this.userPermissionCache.delete(`user_${userId}`);
    } else {
      this.userPermissionCache.clear();
    }
  }

  /**
   * Clear role permission cache
   * @param {string} roleName - Role name (optional - clears all if not provided)
   */
  clearRoleCache(roleName = null) {
    if (roleName) {
      this.rolePermissionCache.delete(`role_${roleName}`);
      // Also clear all user caches since they depend on role permissions
      this.userPermissionCache.clear();
    } else {
      this.rolePermissionCache.clear();
      this.userPermissionCache.clear();
    }
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    this.userPermissionCache.clear();
    this.rolePermissionCache.clear();
    this.allPermissionsCache = null;
    this.allPermissionsCacheExpiry = null;
  }

  /**
   * Get permission audit logs
   * @param {Object} filters - Filter options (targetType, targetId, performedBy, etc.)
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>}
   */
  async getAuditLogs(filters = {}, page = 1, limit = 50) {
    try {
      const pool = await connectDB();
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params = [];

      if (filters.targetType) {
        whereClause += ' AND pal.target_type = @targetType';
        params.push({ name: 'targetType', type: sql.VarChar(50), value: filters.targetType });
      }

      if (filters.targetId) {
        whereClause += ' AND pal.target_id = @targetId';
        params.push({ name: 'targetId', type: sql.UniqueIdentifier, value: filters.targetId });
      }

      if (filters.performedBy) {
        whereClause += ' AND pal.performed_by = @performedBy';
        params.push({ name: 'performedBy', type: sql.UniqueIdentifier, value: filters.performedBy });
      }

      if (filters.actionType) {
        whereClause += ' AND pal.action_type = @actionType';
        params.push({ name: 'actionType', type: sql.VarChar(50), value: filters.actionType });
      }

      if (filters.startDate) {
        whereClause += ' AND pal.performed_at >= @startDate';
        params.push({ name: 'startDate', type: sql.DateTime2, value: new Date(filters.startDate) });
      }

      if (filters.endDate) {
        whereClause += ' AND pal.performed_at <= @endDate';
        params.push({ name: 'endDate', type: sql.DateTime2, value: new Date(filters.endDate) });
      }

      // Get total count
      const countRequest = pool.request();
      params.forEach(p => countRequest.input(p.name, p.type, p.value));
      const countResult = await countRequest.query(`SELECT COUNT(*) as total FROM PERMISSION_AUDIT_LOG pal WHERE ${whereClause}`);
      const total = countResult.recordset[0].total;

      // Get paginated data
      const dataRequest = pool.request();
      params.forEach(p => dataRequest.input(p.name, p.type, p.value));
      dataRequest.input('offset', sql.Int, offset);
      dataRequest.input('limit', sql.Int, limit);

      const result = await dataRequest.query(`
        SELECT
          pal.audit_id,
          pal.action_type,
          pal.target_type,
          pal.target_id,
          pal.old_value,
          pal.new_value,
          pal.performed_at,
          pal.reason,
          u.first_name + ' ' + u.last_name as performed_by_name,
          p.permission_key,
          p.permission_name,
          rt.role_name,
          rt.display_name as role_display_name
        FROM PERMISSION_AUDIT_LOG pal
        LEFT JOIN USER_MASTER u ON pal.performed_by = u.user_id
        LEFT JOIN PERMISSIONS p ON pal.permission_id = p.permission_id
        LEFT JOIN ROLE_TEMPLATES rt ON pal.target_id = rt.role_template_id AND pal.target_type = 'ROLE'
        WHERE ${whereClause}
        ORDER BY pal.performed_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      return {
        logs: result.recordset,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PermissionService();
