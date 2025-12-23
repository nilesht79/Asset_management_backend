/**
 * AUDIT MIDDLEWARE
 * Automatically captures and logs HTTP requests/responses for audit purposes
 */

const { v4: uuidv4 } = require('uuid');
const { auditService, CATEGORIES, ACTION_TYPES } = require('../services/auditService');

// Routes to exclude from automatic audit logging (all methods)
const EXCLUDED_ROUTES = [
  '/health',
  '/api/v1/health',
  '/api/v1/version',
  '/favicon.ico',
  '/api/v1/audit-logs' // Don't audit the audit log queries themselves
];

// Routes to exclude only for GET requests (high-frequency polling)
const EXCLUDED_GET_ROUTES = [
  '/api/v1/notifications',
  '/api/v1/notifications/unread-count',
  '/api/v1/dashboard'
];

// Map HTTP methods to action types
const METHOD_TO_ACTION_TYPE = {
  GET: ACTION_TYPES.READ,
  POST: ACTION_TYPES.CREATE,
  PUT: ACTION_TYPES.UPDATE,
  PATCH: ACTION_TYPES.UPDATE,
  DELETE: ACTION_TYPES.DELETE
};

// Map route patterns to categories and resource types
const ROUTE_MAPPINGS = [
  { pattern: /^\/api\/v1\/auth/, category: CATEGORIES.AUTH, resourceType: 'auth' },
  { pattern: /^\/api\/v1\/oauth/, category: CATEGORIES.AUTH, resourceType: 'oauth' },
  { pattern: /^\/api\/v1\/users/, category: CATEGORIES.USER, resourceType: 'user' },
  { pattern: /^\/api\/v1\/assets/, category: CATEGORIES.ASSET, resourceType: 'asset' },
  { pattern: /^\/api\/v1\/asset-movements/, category: CATEGORIES.ASSET, resourceType: 'asset_movement' },
  { pattern: /^\/api\/v1\/tickets/, category: CATEGORIES.TICKET, resourceType: 'ticket' },
  { pattern: /^\/api\/v1\/jobs/, category: CATEGORIES.TICKET, resourceType: 'job' },
  { pattern: /^\/api\/v1\/requisitions/, category: CATEGORIES.REQUISITION, resourceType: 'requisition' },
  { pattern: /^\/api\/v1\/delivery-tickets/, category: CATEGORIES.REQUISITION, resourceType: 'delivery_ticket' },
  { pattern: /^\/api\/v1\/admin/, category: CATEGORIES.PERMISSION, resourceType: 'admin' },
  { pattern: /^\/api\/v1\/masters/, category: CATEGORIES.MASTER, resourceType: 'master' },
  { pattern: /^\/api\/v1\/departments/, category: CATEGORIES.MASTER, resourceType: 'department' },
  { pattern: /^\/api\/v1\/boards/, category: CATEGORIES.MASTER, resourceType: 'board' },
  { pattern: /^\/api\/v1\/settings/, category: CATEGORIES.SYSTEM, resourceType: 'settings' },
  { pattern: /^\/api\/v1\/sla/, category: CATEGORIES.SYSTEM, resourceType: 'sla' },
  { pattern: /^\/api\/v1\/consumables/, category: CATEGORIES.ASSET, resourceType: 'consumable' },
  { pattern: /^\/api\/v1\/licenses/, category: CATEGORIES.ASSET, resourceType: 'license' },
  { pattern: /^\/api\/v1\/service-reports/, category: CATEGORIES.TICKET, resourceType: 'service_report' },
  { pattern: /^\/api\/v1\/repair-history/, category: CATEGORIES.ASSET, resourceType: 'repair_history' },
  { pattern: /^\/api\/v1\/fault-analysis/, category: CATEGORIES.ASSET, resourceType: 'fault_analysis' },
  { pattern: /^\/api\/v1\/gate-passes/, category: CATEGORIES.ASSET, resourceType: 'gate_pass' },
  { pattern: /^\/api\/v1\/reconciliations/, category: CATEGORIES.ASSET, resourceType: 'reconciliation' },
  { pattern: /^\/api\/v1\/standby/, category: CATEGORIES.ASSET, resourceType: 'standby' },
  { pattern: /^\/api\/v1\/notifications/, category: CATEGORIES.SYSTEM, resourceType: 'notification' },
  { pattern: /^\/api\/v1\/backups/, category: CATEGORIES.SYSTEM, resourceType: 'backup' },
  { pattern: /^\/api\/v1\/dashboard/, category: CATEGORIES.REPORT, resourceType: 'dashboard' },
  { pattern: /^\/api\/v1\/asset-reports/, category: CATEGORIES.REPORT, resourceType: 'report' }
];

/**
 * Get route mapping for a given URL
 * @param {string} url - Request URL
 * @returns {Object} Category and resource type
 */
function getRouteMapping(url) {
  for (const mapping of ROUTE_MAPPINGS) {
    if (mapping.pattern.test(url)) {
      return { category: mapping.category, resourceType: mapping.resourceType };
    }
  }
  return { category: 'other', resourceType: 'unknown' };
}

/**
 * Extract resource ID from URL
 * @param {string} url - Request URL
 * @returns {string|null} Resource ID
 */
function extractResourceId(url) {
  // Common patterns for IDs in URLs
  const patterns = [
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i, // UUID
    /\/(\d+)(?:\/|$)/, // Numeric ID
    /\/([A-Z]{2,4}-\d{4}-\d{4,})(?:\/|$)/i // Pattern like TKT-2025-0001
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Generate action name from HTTP method and route
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {string} resourceType - Resource type
 * @returns {string} Action name
 */
function generateActionName(method, url, resourceType) {
  // Map HTTP methods to past-tense action words
  const actionMap = {
    GET: 'viewed',
    POST: 'created',
    PUT: 'updated',
    PATCH: 'updated',
    DELETE: 'deleted'
  };

  // Check for special action patterns in URL
  if (url.includes('/approve')) return `${resourceType}_approved`;
  if (url.includes('/reject')) return `${resourceType}_rejected`;
  if (url.includes('/assign')) return `${resourceType}_assigned`;
  if (url.includes('/close')) return `${resourceType}_closed`;
  if (url.includes('/reopen')) return `${resourceType}_reopened`;
  if (url.includes('/cancel')) return `${resourceType}_cancelled`;
  if (url.includes('/export')) return `${resourceType}_exported`;
  if (url.includes('/import')) return `${resourceType}_imported`;
  if (url.includes('/bulk')) return `${resourceType}_bulk_operation`;
  if (url.includes('/login')) return 'login_attempt';
  if (url.includes('/logout')) return 'logout';
  if (url.includes('/register')) return 'user_registered';
  if (url.includes('/refresh')) return 'token_refreshed';
  if (url.includes('/status')) return `${resourceType}_status_viewed`;
  if (url.includes('/history')) return `${resourceType}_history_viewed`;
  if (url.includes('/config')) return `${resourceType}_config_viewed`;

  const action = actionMap[method] || 'accessed';
  return `${resourceType}_${action}`;
}

/**
 * Should this request be audited?
 * @param {Object} req - Express request
 * @returns {boolean} Whether to audit
 */
function shouldAudit(req) {
  const url = req.originalUrl || req.url;

  // Skip excluded routes (all methods)
  if (EXCLUDED_ROUTES.some(route => url.startsWith(route))) {
    return false;
  }

  // Skip OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return false;
  }

  // Skip GET requests on high-frequency polling routes to prevent log flooding
  if (req.method === 'GET' && EXCLUDED_GET_ROUTES.some(route => url.startsWith(route))) {
    return false;
  }

  return true;
}

/**
 * Audit middleware - captures request/response for logging
 */
function auditMiddleware(req, res, next) {
  // Skip if audit not needed
  if (!shouldAudit(req)) {
    return next();
  }

  // Generate request ID if not present
  req.id = req.id || req.headers['x-request-id'] || uuidv4();

  // Capture start time
  const startTime = Date.now();

  // Store original response methods
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Response body capture
  let responseBody = null;

  // Override json method
  res.json = function(body) {
    responseBody = body;
    return originalJson(body);
  };

  // Override send method
  res.send = function(body) {
    if (typeof body === 'object') {
      responseBody = body;
    }
    return originalSend(body);
  };

  // Log on response finish
  res.on('finish', () => {
    try {
      const duration = Date.now() - startTime;
      const url = req.originalUrl || req.url;
      const { category, resourceType } = getRouteMapping(url);
      const resourceId = extractResourceId(url) || req.params?.id;
      const actionName = generateActionName(req.method, url, resourceType);

      // Determine status
      let status = 'success';
      if (res.statusCode >= 500) {
        status = 'error';
      } else if (res.statusCode >= 400) {
        status = 'failure';
      }

      // Extract error message if present
      let errorMessage = null;
      if (responseBody && !responseBody.success && responseBody.message) {
        errorMessage = responseBody.message;
      }

      // Get resource name from response if available
      let resourceName = null;
      if (responseBody?.data) {
        const data = responseBody.data;
        resourceName = data.ticket_number ||
                      data.asset_tag ||
                      data.requisition_number ||
                      data.email ||
                      data.name ||
                      data.title ||
                      null;
      }

      // Log the request
      auditService.log(req, {
        action: actionName,
        action_category: category,
        action_type: METHOD_TO_ACTION_TYPE[req.method] || 'EXECUTE',
        resource_type: resourceType,
        resource_id: resourceId,
        resource_name: resourceName,
        status,
        status_code: res.statusCode,
        error_message: errorMessage,
        duration_ms: duration,
        metadata: {
          response_size: res.get('Content-Length'),
          content_type: res.get('Content-Type')
        }
      });
    } catch (error) {
      console.error('Audit middleware error:', error.message);
      // Don't throw - audit failure shouldn't break the request
    }
  });

  next();
}

/**
 * Audit error middleware - logs errors
 */
function auditErrorMiddleware(err, req, res, next) {
  try {
    const url = req.originalUrl || req.url;
    const { category, resourceType } = getRouteMapping(url);

    auditService.logError(
      req,
      `${resourceType}_error`,
      category,
      err.message,
      err.code || err.name
    );
  } catch (auditError) {
    console.error('Audit error middleware failed:', auditError.message);
  }

  next(err);
}

/**
 * Create audit context for manual logging
 * Attach this to req for controllers to use
 */
function attachAuditContext(req, res, next) {
  req.audit = {
    /**
     * Log a custom action
     */
    log: (options) => {
      auditService.log(req, options);
    },

    /**
     * Log with old and new values
     */
    logChange: (action, category, resourceType, resourceId, oldValue, newValue) => {
      auditService.log(req, {
        action,
        action_category: category,
        action_type: ACTION_TYPES.UPDATE,
        resource_type: resourceType,
        resource_id: resourceId,
        old_value: oldValue,
        new_value: newValue,
        changed_fields: auditService.getChangedFields(oldValue, newValue)
      });
    },

    /**
     * Log resource creation
     */
    logCreate: (resourceType, resourceId, resourceName, data) => {
      auditService.log(req, {
        action: `${resourceType}_created`,
        action_category: getRouteMapping(req.url).category,
        action_type: ACTION_TYPES.CREATE,
        resource_type: resourceType,
        resource_id: resourceId,
        resource_name: resourceName,
        new_value: data
      });
    },

    /**
     * Log resource deletion
     */
    logDelete: (resourceType, resourceId, resourceName, data) => {
      auditService.log(req, {
        action: `${resourceType}_deleted`,
        action_category: getRouteMapping(req.url).category,
        action_type: ACTION_TYPES.DELETE,
        resource_type: resourceType,
        resource_id: resourceId,
        resource_name: resourceName,
        old_value: data
      });
    },

    /**
     * Log an error
     */
    logError: (action, errorMessage, errorCode) => {
      const { category } = getRouteMapping(req.url);
      auditService.logError(req, action, category, errorMessage, errorCode);
    }
  };

  next();
}

module.exports = {
  auditMiddleware,
  auditErrorMiddleware,
  attachAuditContext,
  shouldAudit,
  getRouteMapping,
  extractResourceId,
  generateActionName
};
