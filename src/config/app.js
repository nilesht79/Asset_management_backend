require('dotenv').config();

module.exports = {
  app: {
    name: 'Asset Management System',
    version: '1.0.0',
    port: process.env.PORT || 5000,
    env: process.env.NODE_ENV || 'development',
    url: process.env.APP_URL || 'http://localhost:5000',
    apiVersion: process.env.API_VERSION || 'v1'
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN ? 
      process.env.CORS_ORIGIN.split(',') : 
      ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-API-Key'
    ]
  },
  
  rateLimit: {
    windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
    message: {
      error: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  },
  
  upload: {
    path: process.env.UPLOAD_PATH || './uploads',
    maxFileSize: process.env.MAX_FILE_SIZE || 10485760, // 10MB
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ]
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
    maxSize: '10m',
    maxFiles: '14d'
  },
  
  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100
  },
  
  validation: {
    stripUnknown: true,
    abortEarly: false
  }
};