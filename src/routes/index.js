const express = require('express');
const { apiLimiter } = require('../middleware/rate-limit');
const { httpLogger, securityLogger, performanceLogger } = require('../middleware/logging');
const { corsMiddleware } = require('../middleware/cors');

// Import route modules
const authRoutes = require('./auth');
const oauthRoutes = require('./oauth');
const userRoutes = require('./users');
const departmentRoutes = require('./departments');
const masterRoutes = require('./masters');
const assetRoutes = require('./assets');
const assetMovementRoutes = require('./asset-movements');
const dashboardRoutes = require('./dashboard');
const adminRoutes = require('./admin');

const router = express.Router();

// Apply common middleware to all routes
router.use(corsMiddleware);
router.use(httpLogger);
router.use(securityLogger);
router.use(performanceLogger);
// router.use(apiLimiter);

// Health check endpoint (before rate limiting)
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'connected',
      redis: 'connected',
      api: 'running'
    }
  });
});

// API Documentation info
router.get('/', (req, res) => {
  res.status(200).json({
    name: 'Asset Management System API',
    version: '1.0.0',
    description: 'RESTful API for Asset Management System',
    endpoints: {
      auth: '/auth',
      oauth: '/oauth',
      users: '/users',
      departments: '/departments',
      masters: '/masters',
      assets: '/assets',
      assetMovements: '/asset-movements',
      dashboard: '/dashboard',
      admin: '/admin'
    },
    documentation: '/docs',
    health: '/health',
    timestamp: new Date().toISOString()
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/oauth', oauthRoutes);
router.use('/users', userRoutes);
router.use('/departments', departmentRoutes);
router.use('/masters', masterRoutes);
router.use('/assets', assetRoutes);
router.use('/asset-movements', assetMovementRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin', adminRoutes);


// API version info
router.get('/version', (req, res) => {
  res.status(200).json({
    api_version: '1.0.0',
    node_version: process.version,
    uptime: process.uptime(),
    memory_usage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;