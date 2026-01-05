require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { corsMiddleware } = require('./middleware/cors');
const { securityLogger } = require('./middleware/logging');


const { connectDB } = require('./config/database');
const { connectAuditDB } = require('./config/auditDatabase');
const { connectRedis } = require('./config/redis');
const appConfig = require('./config/app');
const { validateCookieSettings } = require('./config/cookies');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error-handler');
const { sendError } = require('./utils/response');
const { auditMiddleware, auditErrorMiddleware, attachAuditContext } = require('./middleware/auditMiddleware');
const { initializeScheduler, stopScheduler } = require('./config/scheduler');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors(appConfig.cors));
app.use(corsMiddleware);

// Rate limiting - DISABLED for now
// const limiter = rateLimit(appConfig.rateLimit);
// app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing middleware for HttpOnly cookies
app.use(cookieParser());

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

 if (process.env.NODE_ENV !== 'test') {
   app.use(securityLogger);
   // optional: also keep httpLogger from logging.js if you want
   // const { httpLogger } = require('./middleware/logging');
   // app.use(httpLogger);
 }

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: appConfig.app.version,
    environment: appConfig.app.env
  });
});

// Serve uploaded files (with authentication)
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Audit middleware - attach context and log requests
app.use(attachAuditContext);
app.use(auditMiddleware);

// API routes
app.use(`/api/${appConfig.app.apiVersion}`, routes);

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
  sendError(res, 'API endpoint not found', 404);
});

// Handle 404 for non-API routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    timestamp: new Date().toISOString()
  });
});

// Audit error middleware - log errors before handling
app.use(auditErrorMiddleware);

// Global error handler
app.use(errorHandler);

// Start server function
const startServer = async () => {
  try {
    // Initialize database connection
    await connectDB();

    // Initialize audit database connection (non-blocking)
    connectAuditDB().catch(err => {
      console.warn('⚠️  Audit database connection failed (non-critical):', err.message);
    });

    // Validate cookie security settings
    validateCookieSettings();

    // Initialize Redis connection
    await connectRedis();

    // Initialize job scheduler
    initializeScheduler();

    // Start the server
    const server = app.listen(appConfig.app.port, () => {
      console.log(`🚀 Server running on port ${appConfig.app.port}`);
      console.log(`📍 Environment: ${appConfig.app.env}`);
      console.log(`🔗 Health check: ${appConfig.app.url}/health`);
      console.log(`📚 API Base URL: ${appConfig.app.url}/api/${appConfig.app.apiVersion}`);
    });

    // Set server timeout for long-running requests (10 minutes)
    server.timeout = 600000;
    server.keepAliveTimeout = 620000; // Slightly higher than timeout

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);

      // Stop all scheduled jobs
      stopScheduler();

      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = app;