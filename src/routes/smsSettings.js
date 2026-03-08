/**
 * SMS SETTINGS ROUTES
 * Superadmin-only routes for managing SMS configuration
 */

const express = require('express');
const router = express.Router();
const SmsSettingsController = require('../controllers/smsSettingsController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

// All routes require authentication and superadmin role
router.use(authenticateToken);
router.use(requireRoles('superadmin'));

// Get SMS configuration
router.get('/', SmsSettingsController.getConfiguration);

// Save SMS configuration
router.post('/', SmsSettingsController.saveConfiguration);

// Test SMS configuration
router.post('/test', SmsSettingsController.testConfiguration);

// Get SMS statistics
router.get('/stats', SmsSettingsController.getStats);

// Toggle SMS service on/off
router.post('/toggle', SmsSettingsController.toggleService);

module.exports = router;
