/**
 * NOTIFICATION CONTROLLER
 * Handles HTTP requests for in-app notifications
 */

const NotificationModel = require('../models/notification');
const { sendSuccess, sendError, sendCreated } = require('../utils/response');

class NotificationController {
  /**
   * Get notifications for authenticated user
   * GET /api/notifications
   */
  static async getNotifications(req, res) {
    try {
      const userId = req.oauth.user.id;
      const {
        page = 1,
        limit = 20,
        is_read,
        notification_type,
        priority
      } = req.query;

      const filters = {};
      if (is_read !== undefined) {
        filters.is_read = is_read === 'true' || is_read === '1';
      }
      if (notification_type) {
        filters.notification_type = notification_type;
      }
      if (priority) {
        filters.priority = priority;
      }

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const result = await NotificationModel.getUserNotifications(
        userId,
        filters,
        pagination
      );

      return sendSuccess(res, result, 'Notifications fetched successfully');
    } catch (error) {
      console.error('Get notifications error:', error);
      return sendError(res, error.message || 'Failed to fetch notifications', 500);
    }
  }

  /**
   * Get unread notifications count
   * GET /api/notifications/unread-count
   */
  static async getUnreadCount(req, res) {
    try {
      const userId = req.oauth.user.id;

      const count = await NotificationModel.getUnreadCount(userId);

      return sendSuccess(res, { unread_count: count }, 'Unread count fetched successfully');
    } catch (error) {
      console.error('Get unread count error:', error);
      return sendError(res, error.message || 'Failed to fetch unread count', 500);
    }
  }

  /**
   * Mark notification as read
   * PUT /api/notifications/:id/read
   */
  static async markAsRead(req, res) {
    try {
      const { id } = req.params;
      const userId = req.oauth.user.id;

      const success = await NotificationModel.markAsRead(id, userId);

      if (!success) {
        return sendError(res, 'Notification not found or already read', 404);
      }

      return sendSuccess(res, null, 'Notification marked as read');
    } catch (error) {
      console.error('Mark as read error:', error);
      return sendError(res, error.message || 'Failed to mark notification as read', 500);
    }
  }

  /**
   * Mark all notifications as read
   * PUT /api/notifications/mark-all-read
   */
  static async markAllAsRead(req, res) {
    try {
      const userId = req.oauth.user.id;

      const count = await NotificationModel.markAllAsRead(userId);

      return sendSuccess(
        res,
        { marked_count: count },
        `${count} notification(s) marked as read`
      );
    } catch (error) {
      console.error('Mark all as read error:', error);
      return sendError(res, error.message || 'Failed to mark all as read', 500);
    }
  }

  /**
   * Delete a notification
   * DELETE /api/notifications/:id
   */
  static async deleteNotification(req, res) {
    try {
      const { id } = req.params;
      const userId = req.oauth.user.id;

      const success = await NotificationModel.deleteNotification(id, userId);

      if (!success) {
        return sendError(res, 'Notification not found', 404);
      }

      return sendSuccess(res, null, 'Notification deleted successfully');
    } catch (error) {
      console.error('Delete notification error:', error);
      return sendError(res, error.message || 'Failed to delete notification', 500);
    }
  }

  /**
   * Get notification by ID
   * GET /api/notifications/:id
   */
  static async getNotificationById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.oauth.user.id;

      const notification = await NotificationModel.getNotificationById(id);

      if (!notification) {
        return sendError(res, 'Notification not found', 404);
      }

      // Verify ownership
      if (notification.user_id !== userId) {
        return sendError(res, 'Access denied', 403);
      }

      return sendSuccess(res, notification, 'Notification fetched successfully');
    } catch (error) {
      console.error('Get notification error:', error);
      return sendError(res, error.message || 'Failed to fetch notification', 500);
    }
  }
}

module.exports = NotificationController;
