/**
 * NOTIFICATION ROUTES
 * Routes for in-app notifications
 */

const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get unread count (placed before /:id to avoid route conflicts)
router.get('/unread-count', NotificationController.getUnreadCount);

// Mark all as read
router.put('/mark-all-read', NotificationController.markAllAsRead);

// Get all notifications for current user
router.get('/', NotificationController.getNotifications);

// Get notification by ID
router.get('/:id', NotificationController.getNotificationById);

// Mark notification as read
router.put('/:id/read', NotificationController.markAsRead);

// Delete notification
router.delete('/:id', NotificationController.deleteNotification);

module.exports = router;
