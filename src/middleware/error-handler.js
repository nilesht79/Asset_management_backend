const { sendError } = require('../utils/response');
const { HTTP_STATUS, ERROR_CODES } = require('../utils/constants');

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let message = err.message || 'Internal server error occurred';
  let errorCode = err.code || ERROR_CODES.INTERNAL_ERROR;
  let errors = err.errors || null;

  // Log error details for debugging
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = HTTP_STATUS.UNPROCESSABLE_ENTITY;
    errorCode = ERROR_CODES.VALIDATION_ERROR;
    message = 'Validation failed';
    errors = err.details || err.errors;
  }
  
  // Handle JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = HTTP_STATUS.UNAUTHORIZED;
    errorCode = ERROR_CODES.AUTHENTICATION_ERROR;
    message = 'Invalid access token';
  }
  
  else if (err.name === 'TokenExpiredError') {
    statusCode = HTTP_STATUS.UNAUTHORIZED;
    errorCode = ERROR_CODES.AUTHENTICATION_ERROR;
    message = 'Access token has expired';
  }
  
  // Handle SQL Server errors
  else if (err.name === 'RequestError' && err.number) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    errorCode = ERROR_CODES.DATABASE_ERROR;
    
    switch (err.number) {
      case 2: // Connection timeout
        statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
        message = 'Database connection timeout';
        break;
      case 2627: // Unique constraint violation
        statusCode = HTTP_STATUS.CONFLICT;
        errorCode = ERROR_CODES.DUPLICATE_RESOURCE;
        message = 'Resource already exists';
        break;
      case 547: // Foreign key constraint violation
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = 'Invalid reference to related resource';
        break;
      case 515: // Cannot insert NULL value
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = 'Required field is missing';
        break;
      default:
        message = 'Database operation failed';
    }
  }
  
  // Handle connection pool errors
  else if (err.name === 'ConnectionError') {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    errorCode = ERROR_CODES.DATABASE_ERROR;
    message = 'Database connection failed';
  }
  
  // Handle file upload errors
  else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    errorCode = ERROR_CODES.FILE_UPLOAD_ERROR;
    message = 'File size exceeds limit';
  }
  
  else if (err.code === 'LIMIT_FILE_COUNT') {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    errorCode = ERROR_CODES.FILE_UPLOAD_ERROR;
    message = 'Too many files uploaded';
  }
  
  else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    errorCode = ERROR_CODES.FILE_UPLOAD_ERROR;
    message = 'Unexpected file field';
  }
  
  // Handle rate limiting errors
  else if (err.status === 429) {
    statusCode = HTTP_STATUS.TOO_MANY_REQUESTS;
    errorCode = ERROR_CODES.RATE_LIMIT_ERROR;
    message = 'Too many requests, please try again later';
  }
  
  // Handle syntax errors (usually from malformed JSON)
  else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    errorCode = ERROR_CODES.VALIDATION_ERROR;
    message = 'Invalid JSON in request body';
  }
  
  // Handle custom application errors
  else if (err.isOperational) {
    statusCode = err.statusCode;
    message = err.message;
    errorCode = err.code;
    errors = err.errors;
  }
  
  // Don't leak sensitive information in production
  if (process.env.NODE_ENV === 'production') {
    // Remove stack trace and sensitive details
    delete err.stack;
    
    // Use generic message for unknown errors
    if (statusCode === HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      message = 'An unexpected error occurred';
    }
  }

  // Send error response
  const errorResponse = {
    success: false,
    message,
    code: errorCode,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: {
        originalMessage: err.message,
        name: err.name,
        ...(err.number && { sqlErrorNumber: err.number })
      }
    }),
    timestamp: new Date().toISOString()
  };

  res.status(statusCode).json(errorResponse);
};

// Async error wrapper to catch errors in async route handlers
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, code = ERROR_CODES.INTERNAL_ERROR, errors = null) {
    super(message);
    
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(errors, message = 'Validation failed') {
    super(message, HTTP_STATUS.UNPROCESSABLE_ENTITY, ERROR_CODES.VALIDATION_ERROR, errors);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTHENTICATION_ERROR);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTHORIZATION_ERROR);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, HTTP_STATUS.CONFLICT, ERROR_CODES.DUPLICATE_RESOURCE);
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.DATABASE_ERROR);
  }
}

// 404 handler for undefined routes
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`);
  next(error);
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  DatabaseError
};