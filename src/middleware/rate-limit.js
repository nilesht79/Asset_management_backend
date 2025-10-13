const rateLimit = require('express-rate-limit');
const { getRedisClient, isRedisConnected } = require('../config/redis');
const { sendError } = require('../utils/response');
const { HTTP_STATUS } = require('../utils/constants');

// Redis store for rate limiting (optional, falls back to memory)
class RedisStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'rate_limit:';
    this.expiry = options.expiry || 60;
  }

  async increment(key) {
    try {
      // Check if Redis is connected, if not fall back to memory store
      if (!isRedisConnected()) {
        console.warn('Redis not connected, falling back to memory store');
        return undefined; // Let express-rate-limit use memory store
      }

      const client = getRedisClient();
      const fullKey = this.prefix + key;
      
      const current = await client.incr(fullKey);
      
      if (current === 1) {
        await client.expire(fullKey, this.expiry);
      }
      
      const ttl = await client.ttl(fullKey);
      const resetTime = new Date(Date.now() + (ttl * 1000));
      
      return {
        totalHits: current,
        resetTime
      };
    } catch (error) {
      console.error('Redis rate limit error:', error);
      // Return undefined to fall back to memory store
      return undefined;
    }
  }

  async decrement(key) {
    try {
      if (!isRedisConnected()) {
        return;
      }
      
      const client = getRedisClient();
      const fullKey = this.prefix + key;
      await client.decr(fullKey);
    } catch (error) {
      console.error('Redis rate limit decrement error:', error);
    }
  }

  async reset(key) {
    try {
      if (!isRedisConnected()) {
        return;
      }
      
      const client = getRedisClient();
      const fullKey = this.prefix + key;
      await client.del(fullKey);
    } catch (error) {
      console.error('Redis rate limit reset error:', error);
    }
  }

  async resetAll() {
    try {
      if (!isRedisConnected()) {
        return;
      }
      
      const client = getRedisClient();
      const keys = await client.keys(this.prefix + '*');
      if (keys.length > 0) {
        await client.del(keys);
      }
    } catch (error) {
      console.error('Redis rate limit reset all error:', error);
    }
  }
}

// Create a safe store that falls back to memory if Redis fails
const createStore = (options = {}) => {
  try {
    // Only use Redis store if Redis is connected
    if (isRedisConnected()) {
      return new RedisStore(options);
    } else {
      console.warn('Redis not connected, using memory store for rate limiting');
      return undefined; // Use default memory store
    }
  } catch (error) {
    console.error('Failed to create Redis store, using memory store:', error.message);
    return undefined; // Use default memory store
  }
};

// Default rate limiting configuration
const defaultOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use IP address and user ID (if authenticated) for more precise limiting
    return req.user ? `${req.ip}:${req.user.id}` : req.ip;
  },
  handler: (req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.round((req.rateLimit.resetTime - Date.now()) / 1000),
      timestamp: new Date().toISOString()
    });
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.url === '/health' || req.url === '/ping';
  }
};

// General API rate limiter
const apiLimiter = rateLimit({
  ...defaultOptions,
  store: createStore({ expiry: 15 * 60 })
});

// Strict rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    success: false,
    message: 'Too many login attempts from this IP, please try again after 15 minutes.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore({ prefix: 'auth_limit:', expiry: 15 * 60 }),
  skipSuccessfulRequests: true, // Don't count successful requests
  skipFailedRequests: false, // Count failed requests
});

// Stricter rate limiter for password reset
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset attempts per hour
  message: {
    success: false,
    message: 'Too many password reset attempts from this IP, please try again after 1 hour.',
    code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  store: createStore({ prefix: 'pwd_reset:', expiry: 60 * 60 }),
});

// Registration rate limiter
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 registration attempts per hour
  message: {
    success: false,
    message: 'Too many registration attempts from this IP, please try again after 1 hour.',
    code: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  store: createStore({ prefix: 'registration:', expiry: 60 * 60 }),
});

// File upload rate limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 file uploads per minute
  message: {
    success: false,
    message: 'Too many file uploads from this IP, please try again later.',
    code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  store: createStore({ prefix: 'upload_limit:', expiry: 60 }),
});

// API endpoint specific rate limiters
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit search requests to 30 per minute
  message: {
    success: false,
    message: 'Too many search requests, please slow down.',
    code: 'SEARCH_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  store: createStore({ prefix: 'search_limit:', expiry: 60 }),
});

const reportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit report generation to 10 per 5 minutes
  message: {
    success: false,
    message: 'Too many report generation requests, please try again later.',
    code: 'REPORT_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  store: createStore({ prefix: 'report_limit:', expiry: 5 * 60 }),
});

// Bulk operation rate limiter
const bulkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit bulk operations to 5 per 10 minutes
  message: {
    success: false,
    message: 'Too many bulk operations, please try again later.',
    code: 'BULK_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  store: createStore({ prefix: 'bulk_limit:', expiry: 10 * 60 }),
});

// Dynamic rate limiter based on user role
const createRoleLimiter = (limits) => {
  return (req, res, next) => {
    const userRole = req.user?.role || 'guest';
    const limit = limits[userRole] || limits.default || 100;
    
    const roleLimiter = rateLimit({
      ...defaultOptions,
      max: limit,
      keyGenerator: (req) => `${req.ip}:${userRole}:${req.user?.id || 'anonymous'}`,
      store: createStore({ prefix: `role_limit_${userRole}:`, expiry: 15 * 60 }),
    });
    
    return roleLimiter(req, res, next);
  };
};

// Usage-based rate limiter (more requests for premium users)
const usageLimiter = createRoleLimiter({
  superadmin: 1000,
  admin: 500,
  department_head: 200,
  coordinator: 150,
  department_coordinator: 150,
  engineer: 100,
  employee: 50,
  default: 25
});

// Create custom rate limiter
const createLimiter = (options = {}) => {
  return rateLimit({
    ...defaultOptions,
    ...options,
    store: createStore({ 
      prefix: options.prefix || 'custom_limit:', 
      expiry: Math.floor((options.windowMs || defaultOptions.windowMs) / 1000)
    }),
  });
};

// Middleware to add rate limit info to response headers
const rateLimitInfo = (req, res, next) => {
  if (req.rateLimit) {
    res.setHeader('X-RateLimit-Limit', req.rateLimit.limit);
    res.setHeader('X-RateLimit-Remaining', req.rateLimit.remaining);
    res.setHeader('X-RateLimit-Reset', req.rateLimit.resetTime);
  }
  next();
};

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  registrationLimiter,
  uploadLimiter,
  searchLimiter,
  reportLimiter,
  bulkLimiter,
  usageLimiter,
  createLimiter,
  rateLimitInfo,
  RedisStore
};