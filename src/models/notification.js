/**
 * NOTIFICATION MODEL
 * Handles database operations for in-app user notifications
 */

const { connectDB, sql } = require('../config/database');

class NotificationModel {
  /**
   * Create a new notification
   * @param {Object} notificationData - Notification data
   * @returns {Object} Created notification
   */
  static async createNotification(notificationData) {
    try {
      const pool = await connectDB();

      const {
        user_id,
        ticket_id,
        notification_type,
        title,
        message,
        priority = 'medium',
        related_data
      } = notificationData;

      const relatedDataJson = related_data ? JSON.stringify(related_data) : null;

      const query = `
        INSERT INTO USER_NOTIFICATIONS (
          notification_id, user_id, ticket_id, notification_type,
          title, message, priority, related_data,
          is_read, created_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @userId, @ticketId, @notificationType,
          @title, @message, @priority, @relatedData,
          0, GETUTCDATE()
        )
      `;

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, user_id)
        .input('ticketId', sql.UniqueIdentifier, ticket_id)
        .input('notificationType', sql.NVarChar(50), notification_type)
        .input('title', sql.NVarChar(200), title)
        .input('message', sql.NVarChar(1000), message)
        .input('priority', sql.NVarChar(20), priority)
        .input('relatedData', sql.NVarChar(sql.MAX), relatedDataJson)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create notifications for multiple users
   * @param {Array} userIds - Array of user IDs
   * @param {Object} notificationData - Notification data (same for all users)
   * @returns {Array} Created notifications
   */
  static async createBulkNotifications(userIds, notificationData) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        const results = [];
        const {
          ticket_id,
          notification_type,
          title,
          message,
          priority = 'medium',
          related_data
        } = notificationData;

        const relatedDataJson = related_data ? JSON.stringify(related_data) : null;

        for (const user_id of userIds) {
          const result = await transaction.request()
            .input('userId', sql.UniqueIdentifier, user_id)
            .input('ticketId', sql.UniqueIdentifier, ticket_id)
            .input('notificationType', sql.NVarChar(50), notification_type)
            .input('title', sql.NVarChar(200), title)
            .input('message', sql.NVarChar(1000), message)
            .input('priority', sql.NVarChar(20), priority)
            .input('relatedData', sql.NVarChar(sql.MAX), relatedDataJson)
            .query(`
              INSERT INTO USER_NOTIFICATIONS (
                notification_id, user_id, ticket_id, notification_type,
                title, message, priority, related_data,
                is_read, created_at
              )
              OUTPUT INSERTED.*
              VALUES (
                NEWID(), @userId, @ticketId, @notificationType,
                @title, @message, @priority, @relatedData,
                0, GETUTCDATE()
              )
            `);

          if (result.recordset.length > 0) {
            results.push(result.recordset[0]);
          }
        }

        await transaction.commit();
        return results;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Get notifications for a user
   * @param {string} userId - User ID
   * @param {Object} filters - Optional filters
   * @param {Object} pagination - Pagination options
   * @returns {Object} Notifications with pagination info
   */
  static async getUserNotifications(userId, filters = {}, pagination = { page: 1, limit: 20 }) {
    try {
      const pool = await connectDB();

      const { is_read, notification_type, priority } = filters;
      const { page = 1, limit = 20 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE un.user_id = @userId';

      if (is_read !== undefined) {
        whereClause += ` AND un.is_read = ${is_read ? 1 : 0}`;
      }

      if (notification_type) {
        whereClause += ` AND un.notification_type = @notificationType`;
      }

      if (priority) {
        whereClause += ` AND un.priority = @priority`;
      }

      const query = `
        SELECT
          un.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority AS ticket_priority,
          t.status AS ticket_status
        FROM USER_NOTIFICATIONS un
        LEFT JOIN TICKETS t ON un.ticket_id = t.ticket_id
        ${whereClause}
        ORDER BY un.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total
        FROM USER_NOTIFICATIONS un
        ${whereClause}
      `;

      const request = pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      if (notification_type) {
        request.input('notificationType', sql.NVarChar(50), notification_type);
      }

      if (priority) {
        request.input('priority', sql.NVarChar(20), priority);
      }

      const [notificationsResult, countResult] = await Promise.all([
        request.query(query),
        pool.request()
          .input('userId', sql.UniqueIdentifier, userId)
          .input('notificationType', sql.NVarChar(50), notification_type)
          .input('priority', sql.NVarChar(20), priority)
          .query(countQuery)
      ]);

      const total = countResult.recordset[0].total;

      return {
        notifications: notificationsResult.recordset,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      throw error;
    }
  }

  /**
   * Get unread count for a user
   * @param {string} userId - User ID
   * @returns {number} Unread count
   */
  static async getUnreadCount(userId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT COUNT(*) AS unread_count
          FROM USER_NOTIFICATIONS
          WHERE user_id = @userId AND is_read = 0
        `);

      return result.recordset[0].unread_count;
    } catch (error) {
      console.error('Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID (for verification)
   * @returns {boolean} Success
   */
  static async markAsRead(notificationId, userId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('notificationId', sql.UniqueIdentifier, notificationId)
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          UPDATE USER_NOTIFICATIONS
          SET is_read = 1, read_at = GETUTCDATE()
          WHERE notification_id = @notificationId AND user_id = @userId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   * @returns {number} Number of notifications marked as read
   */
  static async markAllAsRead(userId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          UPDATE USER_NOTIFICATIONS
          SET is_read = 1, read_at = GETUTCDATE()
          WHERE user_id = @userId AND is_read = 0
        `);

      return result.rowsAffected[0];
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Delete a notification
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID (for verification)
   * @returns {boolean} Success
   */
  static async deleteNotification(notificationId, userId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('notificationId', sql.UniqueIdentifier, notificationId)
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          DELETE FROM USER_NOTIFICATIONS
          WHERE notification_id = @notificationId AND user_id = @userId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Delete old read notifications (cleanup)
   * @param {number} daysOld - Delete notifications older than X days
   * @returns {number} Number of deleted notifications
   */
  static async deleteOldNotifications(daysOld = 30) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('daysOld', sql.Int, daysOld)
        .query(`
          DELETE FROM USER_NOTIFICATIONS
          WHERE is_read = 1
            AND read_at < DATEADD(DAY, -@daysOld, GETUTCDATE())
        `);

      return result.rowsAffected[0];
    } catch (error) {
      console.error('Error deleting old notifications:', error);
      throw error;
    }
  }

  /**
   * Get notification by ID
   * @param {string} notificationId - Notification ID
   * @returns {Object} Notification
   */
  static async getNotificationById(notificationId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('notificationId', sql.UniqueIdentifier, notificationId)
        .query(`
          SELECT
            un.*,
            t.ticket_number,
            t.title AS ticket_title
          FROM USER_NOTIFICATIONS un
          LEFT JOIN TICKETS t ON un.ticket_id = t.ticket_id
          WHERE un.notification_id = @notificationId
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error getting notification by ID:', error);
      throw error;
    }
  }
}

module.exports = NotificationModel;
