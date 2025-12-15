/**
 * EMAIL SETTINGS ROUTES
 * Superadmin-only routes for managing email configuration
 */

const express = require('express');
const router = express.Router();
const EmailSettingsController = require('../controllers/emailSettingsController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

// All routes require authentication and superadmin role
router.use(authenticateToken);
router.use(requireRoles('superadmin'));

// Get email configuration
router.get('/', EmailSettingsController.getConfiguration);

// Save email configuration
router.post('/', EmailSettingsController.saveConfiguration);

// Test email configuration
router.post('/test', EmailSettingsController.testConfiguration);

// Get email statistics
router.get('/stats', EmailSettingsController.getStats);

// Toggle email service on/off
router.post('/toggle', EmailSettingsController.toggleService);

module.exports = router;
