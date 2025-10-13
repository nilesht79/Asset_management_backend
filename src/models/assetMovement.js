const { connectDB } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Asset Movement Model
 * Handles all database operations for asset movement tracking
 */

class AssetMovementModel {
  /**
   * Get movement history for a specific asset
   * @param {string} assetId - Asset UUID
   * @param {object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Movement history records
   */
  static async getAssetMovementHistory(assetId, options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 100, offset = 0, orderBy = 'movement_date DESC' } = options;

      const result = await pool.request()
        .input('asset_id', assetId)
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE asset_id = @asset_id
          ORDER BY ${orderBy}
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching asset movement history:', error);
      throw error;
    }
  }

  /**
   * Get all movements for a user (assets assigned to them)
   * @param {string} userId - User UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Movement records
   */
  static async getUserMovementHistory(userId, options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 100, offset = 0 } = options;

      const result = await pool.request()
        .input('user_id', userId)
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE assigned_to = @user_id
          ORDER BY movement_date DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching user movement history:', error);
      throw error;
    }
  }

  /**
   * Get all movements for a location
   * @param {string} locationId - Location UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Movement records
   */
  static async getLocationMovementHistory(locationId, options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 100, offset = 0 } = options;

      const result = await pool.request()
        .input('location_id', locationId)
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE location_id = @location_id
          ORDER BY movement_date DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching location movement history:', error);
      throw error;
    }
  }

  /**
   * Get recent movements (all assets)
   * @param {object} options - Query options
   * @returns {Promise<Array>} Recent movement records
   */
  static async getRecentMovements(options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 50, offset = 0 } = options;

      const result = await pool.request()
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          ORDER BY movement_date DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching recent movements:', error);
      throw error;
    }
  }

  /**
   * Create a new movement record
   * @param {object} movementData - Movement details
   * @param {string} performedBy - User ID who performed the action
   * @returns {Promise<object>} Created movement record
   */
  static async createMovement(movementData, performedBy) {
    try {
      const pool = await connectDB();
      const {
        assetId,
        assignedTo = null,
        locationId = null,
        movementType,
        status,
        previousUserId = null,
        previousLocationId = null,
        movementDate = new Date(),
        reason = null,
        notes = null
      } = movementData;

      // Get asset details
      const assetResult = await pool.request()
        .input('asset_id', assetId)
        .query('SELECT asset_tag FROM ASSETS WHERE id = @asset_id');

      if (assetResult.recordset.length === 0) {
        throw new Error('Asset not found');
      }

      const assetTag = assetResult.recordset[0].asset_tag;

      // Get assigned user name if exists
      let assignedToName = null;
      if (assignedTo) {
        const userResult = await pool.request()
          .input('user_id', assignedTo)
          .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @user_id');

        if (userResult.recordset.length > 0) {
          const user = userResult.recordset[0];
          assignedToName = `${user.first_name} ${user.last_name}`;
        }
      }

      // Get location name if exists
      let locationName = null;
      if (locationId) {
        const locationResult = await pool.request()
          .input('location_id', locationId)
          .query('SELECT name FROM LOCATIONS WHERE id = @location_id');

        if (locationResult.recordset.length > 0) {
          locationName = locationResult.recordset[0].name;
        }
      }

      // Get previous user name if exists
      let previousUserName = null;
      if (previousUserId) {
        const prevUserResult = await pool.request()
          .input('user_id', previousUserId)
          .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @user_id');

        if (prevUserResult.recordset.length > 0) {
          const user = prevUserResult.recordset[0];
          previousUserName = `${user.first_name} ${user.last_name}`;
        }
      }

      // Get previous location name if exists
      let previousLocationName = null;
      if (previousLocationId) {
        const prevLocResult = await pool.request()
          .input('location_id', previousLocationId)
          .query('SELECT name FROM LOCATIONS WHERE id = @location_id');

        if (prevLocResult.recordset.length > 0) {
          previousLocationName = prevLocResult.recordset[0].name;
        }
      }

      // Get performer name and ID
      let performedByUserId = performedBy;
      let performedByName = 'System';

      if (performedBy) {
        const performerResult = await pool.request()
          .input('user_id', performedBy)
          .query('SELECT user_id, first_name, last_name FROM USER_MASTER WHERE user_id = @user_id');

        if (performerResult.recordset.length > 0) {
          const performer = performerResult.recordset[0];
          performedByUserId = performer.user_id;
          performedByName = `${performer.first_name} ${performer.last_name}`;
        } else {
          console.warn(`Performer user not found for ID: ${performedBy}. Using system user.`);
          performedByUserId = null;
        }
      } else {
        console.warn('No performedBy ID provided. Using system user.');
        performedByUserId = null;
      }

      // If no valid performer, get a system admin user
      if (!performedByUserId) {
        const systemUserResult = await pool.request()
          .query(`
            SELECT TOP 1 user_id, first_name, last_name
            FROM USER_MASTER
            WHERE role IN ('superadmin', 'admin') AND is_active = 1
            ORDER BY created_at ASC
          `);

        if (systemUserResult.recordset.length > 0) {
          const systemUser = systemUserResult.recordset[0];
          performedByUserId = systemUser.user_id;
          performedByName = `${systemUser.first_name} ${systemUser.last_name} (System)`;
        } else {
          throw new Error('No system user available for movement logging');
        }
      }

      // Insert movement record
      const movementId = uuidv4();
      const result = await pool.request()
        .input('id', movementId)
        .input('asset_id', assetId)
        .input('asset_tag', assetTag)
        .input('assigned_to', assignedTo)
        .input('assigned_to_name', assignedToName)
        .input('location_id', locationId)
        .input('location_name', locationName)
        .input('movement_type', movementType)
        .input('status', status)
        .input('previous_user_id', previousUserId)
        .input('previous_user_name', previousUserName)
        .input('previous_location_id', previousLocationId)
        .input('previous_location_name', previousLocationName)
        .input('movement_date', movementDate)
        .input('reason', reason)
        .input('notes', notes)
        .input('performed_by', performedByUserId)
        .input('performed_by_name', performedByName)
        .query(`
          INSERT INTO ASSET_MOVEMENTS (
            id, asset_id, asset_tag,
            assigned_to, assigned_to_name,
            location_id, location_name,
            movement_type, status,
            previous_user_id, previous_user_name,
            previous_location_id, previous_location_name,
            movement_date, reason, notes,
            performed_by, performed_by_name,
            created_at
          )
          OUTPUT INSERTED.*
          VALUES (
            @id, @asset_id, @asset_tag,
            @assigned_to, @assigned_to_name,
            @location_id, @location_name,
            @movement_type, @status,
            @previous_user_id, @previous_user_name,
            @previous_location_id, @previous_location_name,
            @movement_date, @reason, @notes,
            @performed_by, @performed_by_name,
            GETUTCDATE()
          )
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating movement record:', error);
      throw error;
    }
  }

  /**
   * Get movement statistics for dashboard
   * @param {object} filters - Date range filters
   * @returns {Promise<object>} Statistics
   */
  static async getMovementStatistics(filters = {}) {
    try {
      const pool = await connectDB();
      const { startDate, endDate } = filters;

      let dateFilter = '';
      if (startDate && endDate) {
        dateFilter = `WHERE movement_date BETWEEN '${startDate}' AND '${endDate}'`;
      }

      const result = await pool.request().query(`
        SELECT
          COUNT(*) as total_movements,
          COUNT(DISTINCT asset_id) as unique_assets,
          COUNT(DISTINCT assigned_to) as unique_users,
          SUM(CASE WHEN movement_type = 'assigned' THEN 1 ELSE 0 END) as assignments,
          SUM(CASE WHEN movement_type = 'transferred' THEN 1 ELSE 0 END) as transfers,
          SUM(CASE WHEN movement_type = 'returned' THEN 1 ELSE 0 END) as returns,
          SUM(CASE WHEN movement_type = 'relocated' THEN 1 ELSE 0 END) as relocations
        FROM ASSET_MOVEMENTS
        ${dateFilter}
      `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching movement statistics:', error);
      throw error;
    }
  }

  /**
   * Get current assignment for an asset (most recent movement)
   * @param {string} assetId - Asset UUID
   * @returns {Promise<object>} Current movement record
   */
  static async getCurrentAssignment(assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('asset_id', assetId)
        .query(`
          SELECT TOP 1
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            movement_date,
            reason,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE asset_id = @asset_id
          ORDER BY movement_date DESC
        `);

      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching current assignment:', error);
      throw error;
    }
  }
}

module.exports = AssetMovementModel;
