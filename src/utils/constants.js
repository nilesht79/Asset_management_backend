module.exports = {
  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
  },

  // User Roles
  USER_ROLES: {
    SUPERADMIN: 'superadmin',
    ADMIN: 'admin',
    IT_HEAD: 'it_head',
    DEPARTMENT_HEAD: 'department_head',
    COORDINATOR: 'coordinator',
    DEPARTMENT_COORDINATOR: 'department_coordinator',
    ENGINEER: 'engineer',
    EMPLOYEE: 'employee'
  },

  // Asset Status
  ASSET_STATUS: {
    AVAILABLE: 'available',
    ASSIGNED: 'assigned',
    IN_MAINTENANCE: 'in_maintenance',
    OUT_OF_ORDER: 'out_of_order',
    DISPOSED: 'disposed',
    LOST: 'lost',
    STOLEN: 'stolen'
  },

  // Asset Conditions
  ASSET_CONDITION: {
    NEW: 'new',
    EXCELLENT: 'excellent',
    GOOD: 'good',
    FAIR: 'fair',
    POOR: 'poor',
    DAMAGED: 'damaged'
  },

  // Requisition Status
  REQUISITION_STATUS: {
    DRAFT: 'draft',
    SUBMITTED: 'submitted',
    DEPT_APPROVED: 'dept_approved',
    DEPT_REJECTED: 'dept_rejected',
    IT_APPROVED: 'it_approved',
    IT_REJECTED: 'it_rejected',
    FULFILLED: 'fulfilled',
    PARTIALLY_FULFILLED: 'partially_fulfilled',
    CANCELLED: 'cancelled'
  },

  // Ticket Status
  TICKET_STATUS: {
    OPEN: 'open',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in_progress',
    PENDING: 'pending',
    RESOLVED: 'resolved',
    CLOSED: 'closed',
    CANCELLED: 'cancelled'
  },

  // Ticket Priority
  TICKET_PRIORITY: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
    EMERGENCY: 'emergency'
  },

  // SLA Types
  SLA_TYPE: {
    RESPONSE: 'response',
    RESOLUTION: 'resolution'
  },

  // SLA Status
  SLA_STATUS: {
    WITHIN_SLA: 'within_sla',
    APPROACHING_BREACH: 'approaching_breach',
    BREACHED: 'breached'
  },

  // Notification Types
  NOTIFICATION_TYPE: {
    EMAIL: 'email',
    SMS: 'sms',
    WHATSAPP: 'whatsapp',
    SYSTEM: 'system'
  },

  // Notification Status
  NOTIFICATION_STATUS: {
    PENDING: 'pending',
    SENT: 'sent',
    DELIVERED: 'delivered',
    FAILED: 'failed',
    BOUNCED: 'bounced'
  },

  // File Types
  FILE_TYPES: {
    IMAGE: ['image/jpeg', 'image/png', 'image/gif'],
    DOCUMENT: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    SPREADSHEET: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    CSV: ['text/csv'],
    ALL_ALLOWED: [
      'image/jpeg', 'image/png', 'image/gif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ]
  },

  // Date Formats
  DATE_FORMATS: {
    DATE_ONLY: 'YYYY-MM-DD',
    DATETIME: 'YYYY-MM-DD HH:mm:ss',
    DISPLAY_DATE: 'DD MMM YYYY',
    DISPLAY_DATETIME: 'DD MMM YYYY, hh:mm A'
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100
  },

  // Cache TTL (in seconds)
  CACHE_TTL: {
    SHORT: 300,      // 5 minutes
    MEDIUM: 1800,    // 30 minutes
    LONG: 3600,      // 1 hour
    VERY_LONG: 86400 // 24 hours
  },

  // Queue Job Types
  QUEUE_JOBS: {
    SEND_EMAIL: 'send_email',
    SEND_SMS: 'send_sms',
    SEND_WHATSAPP: 'send_whatsapp',
    GENERATE_REPORT: 'generate_report',
    SLA_CHECK: 'sla_check',
    ASSET_MAINTENANCE_REMINDER: 'asset_maintenance_reminder',
    BACKUP_DATA: 'backup_data',
    CLEANUP_FILES: 'cleanup_files',
    BULK_IMPORT: 'bulk_import'
  },

  // Error Codes
  ERROR_CODES: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
    DATABASE_ERROR: 'DATABASE_ERROR',
    FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
    RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
  },

  // Response Messages
  MESSAGES: {
    SUCCESS: 'Operation completed successfully',
    CREATED: 'Resource created successfully',
    UPDATED: 'Resource updated successfully',
    DELETED: 'Resource deleted successfully',
    NOT_FOUND: 'Resource not found',
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'Access forbidden',
    VALIDATION_ERROR: 'Validation failed',
    INTERNAL_ERROR: 'Internal server error occurred'
  }
};