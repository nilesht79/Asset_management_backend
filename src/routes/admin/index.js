const express = require('express');
const router = express.Router();

// Import admin route modules
const permissionsRoutes = require('./permissions');

// Admin routes - all require admin-level access
router.use('/permissions', permissionsRoutes);

module.exports = router;