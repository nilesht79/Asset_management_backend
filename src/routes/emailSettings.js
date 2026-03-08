/**
 * EMAIL SETTINGS ROUTES
 * Superadmin-only routes for managing email configuration
 * Includes Microsoft OAuth callback (unauthenticated — runs in popup)
 */

const express = require('express');
const router = express.Router();
const EmailSettingsController = require('../controllers/emailSettingsController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

// Microsoft OAuth callback — must be BEFORE auth middleware (runs in popup, no JWT)
router.get('/microsoft/callback', EmailSettingsController.handleMicrosoftCallback);

// All other routes require authentication and superadmin role
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

// Microsoft OAuth routes
router.get('/microsoft/auth-url', EmailSettingsController.getMicrosoftAuthUrl);
router.post('/microsoft/revoke', EmailSettingsController.revokeMicrosoftAuth);

module.exports = router;
