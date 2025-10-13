const morgan = require('morgan');
const winston = require('winston');
const path = require('path');

// Create winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'asset-management-api',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // Write all logs to `combined.log`
    new winston.transports.File({ 
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Custom token for user ID
morgan.token('user-id', (req) => {
  return req.user?.id || 'anonymous';
});

// Custom token for user role
morgan.token('user-role', (req) => {
  return req.user?.role || 'guest';
});

// Custom token for request duration
morgan.token('response-time-ms', (req, res) => {
  if (!req._startAt || !res._startAt) {
    return '';
  }
  
  const ms = (res._startAt[0] - req._startAt[0]) * 1000 +
            (res._startAt[1] - req._startAt[1]) * 1e-6;
  
  return ms.toFixed(3);
});

// Custom token for request body size
morgan.token('req-size', (req) => {
  return req.get('content-length') || '0';
});

// Custom token for response body size
morgan.token('res-size', (req, res) => {
  return res.get('content-length') || '0';
});

// Request logging format
const logFormat = ':remote-addr - :user-id [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time-ms ms :user-role';

// Detailed log format for debugging
const detailedLogFormat = [
  ':remote-addr',
  ':user-id',
  '[:date[clf]]',
  '":method :url HTTP/:http-version"',
  ':status',
  ':res[content-length]',
  '":referrer"',
  '":user-agent"',
  ':response-time-ms ms',
  ':user-role',
  'req-size::req-size',
  'res-size::res-size'
].join(' ');

// Morgan middleware for HTTP request logging
const httpLogger = morgan(logFormat, {
  stream: {
    write: (message) => {
      logger.info(message.trim());
    }
  },
  skip: (req, res) => {
    // Skip logging for health check endpoints
    if (req.url === '/health' || req.url === '/ping') {
      return true;
    }
    
    // Skip successful requests in production (optional)
    if (process.env.NODE_ENV === 'production' && res.statusCode < 400) {
      return true;
    }
    
    return false;
  }
});

// Detailed HTTP logger for debugging
const detailedHttpLogger = morgan(detailedLogFormat, {
  stream: {
    write: (message) => {
      logger.debug(message.trim());
    }
  }
});

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  const errorInfo = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    role: req.user?.role,
    body: req.method !== 'GET' ? req.body : undefined,
    params: req.params,
    query: req.query,
    headers: {
      'content-type': req.get('content-type'),
      'accept': req.get('accept'),
      'authorization': req.get('authorization') ? '[REDACTED]' : undefined
    }
  };

  logger.error('Request error:', errorInfo);
  next(err);
};

// Security logging middleware
const securityLogger = (req, res, next) => {
  logger.info(`SECURITY: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    user: req.user ? req.user.id : null
  });
  next();
};


// const securityLogger = (req, res, next) => {
//   // Log suspicious activities
//   const suspiciousPatterns = [
//     /union.*select/i,
//     /script.*alert/i,
//     /<script/i,
//     /javascript:/i,
//     /vbscript:/i,
//     /onload=/i,
//     /onerror=/i
//   ];

//   const requestData = JSON.stringify({
//     body: req.body,
//     query: req.query,
//     params: req.params
//   });

//   const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(requestData));

//   if (isSuspicious) {
//     logger.warn('Suspicious request detected:', {
//       ip: req.ip,
//       userAgent: req.get('User-Agent'),
//       url: req.url,
//       method: req.method,
//       userId: req.user?.id,
//       data: requestData
//     });
//   }

//   // Log failed authentication attempts
//   if (req.url.includes('/auth/login') && req.method === 'POST') {
//     res.on('finish', () => {
//       if (res.statusCode === 401) {
//         logger.warn('Failed login attempt:', {
//           ip: req.ip,
//           userAgent: req.get('User-Agent'),
//           email: req.body?.email,
//           timestamp: new Date().toISOString()
//         });
//       }
//     });
//   }

//   next();
// };



// Performance monitoring middleware
const performanceLogger = (req, res, next) => {
  const startTime = process.hrtime();

  res.on('finish', () => {
    const duration = process.hrtime(startTime);
    const durationMs = duration[0] * 1000 + duration[1] * 1e-6;

    // Log slow requests (> 1 second)
    if (durationMs > 1000) {
      logger.warn('Slow request detected:', {
        method: req.method,
        url: req.url,
        duration: `${durationMs.toFixed(2)}ms`,
        statusCode: res.statusCode,
        userId: req.user?.id
      });
    }

    // Log performance metrics
    logger.debug('Request performance:', {
      method: req.method,
      url: req.url,
      duration: `${durationMs.toFixed(2)}ms`,
      statusCode: res.statusCode,
      contentLength: res.get('content-length'),
      userId: req.user?.id
    });
  });

  next();
};

// Database query logger
const dbLogger = (query, duration) => {
  logger.debug('Database query:', {
    query: query.substring(0, 500), // Limit query length
    duration: `${duration}ms`,
    timestamp: new Date().toISOString()
  });

  // Log slow queries
  if (duration > 1000) {
    logger.warn('Slow database query:', {
      query: query.substring(0, 500),
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  logger,
  httpLogger,
  detailedHttpLogger,
  errorLogger,
  securityLogger,
  performanceLogger,
  dbLogger
};