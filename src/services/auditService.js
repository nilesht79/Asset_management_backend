/**
 * AUDIT SERVICE
 * Centralized service for audit logging across the application
 * Provides easy-to-use methods for logging various types of activities
 */

const AuditLogModel = require('../models/auditLog');
const { v4: uuidv4 } = require('uuid');

// Action categories
const CATEGORIES = {
  AUTH: 'auth',
  USER: 'user',
  ASSET: 'asset',
  TICKET: 'ticket',
  REQUISITION: 'requisition',
  PERMISSION: 'permission',
  MASTER: 'master',
  SYSTEM: 'system',
  FILE: 'file',
  JOB: 'job',
  SECURITY: 'security',
  REPORT: 'report'
};

// Action types
const ACTION_TYPES = {
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  ASSIGN: 'ASSIGN',
  EXECUTE: 'EXECUTE'
};

class AuditService {
  constructor() {
    // Queue for async logging
    this.logQueue = [];
    this.isProcessing = false;
    this.batchSize = 10;
    this.flushInterval = 5000; // 5 seconds

    // Start queue processor
    this.startQueueProcessor();
  }

  /**
   * Start the background queue processor
   */
  startQueueProcessor() {
    setInterval(() => {
      this.processQueue();
    }, this.flushInterval);
  }

  /**
   * Process queued logs
   */
  async processQueue() {
    if (this.isProcessing || this.logQueue.length === 0) return;

    this.isProcessing = true;

    try {
      const batch = this.logQueue.splice(0, this.batchSize);

      for (const logData of batch) {
        try {
          await AuditLogModel.insertLog(logData);
        } catch (error) {
          console.error('Failed to insert audit log:', error.message);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Queue a log entry for async processing
   * @param {Object} logData - Log data
   */
  queueLog(logData) {
    logData.request_id = logData.request_id || uuidv4();
    this.logQueue.push(logData);

    // Process immediately if queue is getting large
    if (this.logQueue.length >= this.batchSize * 2) {
      this.processQueue();
    }
  }

  /**
   * Log immediately (synchronous)
   * @param {Object} logData - Log data
   * @returns {Promise<Object|null>} Audit log result
   */
  async logSync(logData) {
    logData.request_id = logData.request_id || uuidv4();
    return AuditLogModel.insertLog(logData);
  }

  /**
   * Extract user context from request
   * @param {Object} req - Express request object
   * @returns {Object} User context
   */
  extractUserContext(req) {
    const user = req.user || {};
    return {
      user_id: user.id || user.user_id || null,
      user_email: user.email || null,
      user_role: user.role || null,
      user_department_id: user.department_id || null,
      session_id: req.sessionID || req.cookies?.session_id || null,
      ip_address: this.getClientIP(req),
      user_agent: req.get('User-Agent') || null,
      client_type: this.detectClientType(req)
    };
  }

  /**
   * Extract request context
   * @param {Object} req - Express request object
   * @returns {Object} Request context
   */
  extractRequestContext(req) {
    return {
      http_method: req.method,
      endpoint: req.originalUrl || req.url,
      query_params: Object.keys(req.query).length > 0 ? req.query : null,
      request_id: req.id || req.headers['x-request-id'] || uuidv4()
    };
  }

  /**
   * Get client IP address
   * @param {Object} req - Express request object
   * @returns {string} Client IP
   */
  getClientIP(req) {
    return req.ip ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'unknown';
  }

  /**
   * Detect client type from request
   * @param {Object} req - Express request object
   * @returns {string} Client type
   */
  detectClientType(req) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();

    if (userAgent.includes('mobile') || userAgent.includes('android') || userAgent.includes('iphone')) {
      return 'mobile';
    }
    if (userAgent.includes('postman') || userAgent.includes('curl') || userAgent.includes('axios')) {
      return 'api';
    }
    if (!userAgent || userAgent === 'system') {
      return 'system';
    }
    return 'web';
  }

  /**
   * Calculate changed fields between old and new values
   * @param {Object} oldValue - Old value
   * @param {Object} newValue - New value
   * @returns {Array} List of changed field names
   */
  getChangedFields(oldValue, newValue) {
    if (!oldValue || !newValue) return null;

    const changedFields = [];
    const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);

    for (const key of allKeys) {
      // Skip internal fields
      if (['updated_at', 'created_at', 'password', 'password_hash'].includes(key)) continue;

      const oldVal = oldValue[key];
      const newVal = newValue[key];

      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changedFields.push(key);
      }
    }

    return changedFields.length > 0 ? changedFields : null;
  }

  // ==========================================
  // AUTHENTICATION LOGGING
  // ==========================================

  /**
   * Log successful login
   */
  async logLoginSuccess(req, user, authMethod = 'password') {
    const userContext = this.extractUserContext(req);

    // Log to LOGIN_AUDIT table
    await AuditLogModel.insertLoginAudit({
      user_id: user.user_id || user.id,
      user_email: user.email,
      user_role: user.role,
      event_type: 'login_success',
      auth_method: authMethod,
      ip_address: userContext.ip_address,
      user_agent: userContext.user_agent,
      device_info: req.get('User-Agent'),
      session_id: req.sessionID,
      status: 'success'
    });

    // Also log to main audit log
    this.queueLog({
      ...userContext,
      user_id: user.user_id || user.id,
      user_email: user.email,
      user_role: user.role,
      action: 'login_success',
      action_category: CATEGORIES.AUTH,
      action_type: ACTION_TYPES.LOGIN,
      resource_type: 'session',
      status: 'success',
      metadata: { auth_method: authMethod }
    });
  }

  /**
   * Log failed login attempt
   */
  async logLoginFailure(req, email, reason) {
    const userContext = this.extractUserContext(req);

    await AuditLogModel.insertLoginAudit({
      user_email: email,
      event_type: 'login_failed',
      ip_address: userContext.ip_address,
      user_agent: userContext.user_agent,
      device_info: req.get('User-Agent'),
      status: 'failure',
      failure_reason: reason
    });

    this.queueLog({
      ...userContext,
      user_email: email,
      action: 'login_failed',
      action_category: CATEGORIES.AUTH,
      action_type: ACTION_TYPES.LOGIN,
      status: 'failure',
      error_message: reason
    });
  }

  /**
   * Log logout
   */
  async logLogout(req) {
    const userContext = this.extractUserContext(req);

    await AuditLogModel.insertLoginAudit({
      ...userContext,
      event_type: 'logout',
      status: 'success'
    });

    this.queueLog({
      ...userContext,
      action: 'logout',
      action_category: CATEGORIES.AUTH,
      action_type: ACTION_TYPES.LOGOUT,
      status: 'success'
    });
  }

  /**
   * Log token refresh
   */
  async logTokenRefresh(req, user) {
    const userContext = this.extractUserContext(req);

    await AuditLogModel.insertLoginAudit({
      user_id: user.user_id || user.id,
      user_email: user.email,
      user_role: user.role,
      event_type: 'token_refresh',
      ip_address: userContext.ip_address,
      user_agent: userContext.user_agent,
      status: 'success'
    });
  }

  /**
   * Log password reset request
   */
  async logPasswordResetRequest(req, email) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      user_email: email,
      action: 'password_reset_requested',
      action_category: CATEGORIES.AUTH,
      action_type: ACTION_TYPES.UPDATE,
      status: 'success'
    });
  }

  /**
   * Log password change
   */
  async logPasswordChange(req, userId) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'password_changed',
      action_category: CATEGORIES.AUTH,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'user',
      resource_id: userId,
      status: 'success'
    });
  }

  // ==========================================
  // USER MANAGEMENT LOGGING
  // ==========================================

  /**
   * Log user creation
   */
  logUserCreated(req, newUser) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'user_created',
      action_category: CATEGORIES.USER,
      action_type: ACTION_TYPES.CREATE,
      resource_type: 'user',
      resource_id: newUser.user_id || newUser.id,
      resource_name: `${newUser.first_name} ${newUser.last_name}`.trim() || newUser.email,
      new_value: this.sanitizeUserData(newUser),
      status: 'success'
    });
  }

  /**
   * Log user update
   */
  logUserUpdated(req, userId, oldData, newData) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);
    const changedFields = this.getChangedFields(oldData, newData);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'user_updated',
      action_category: CATEGORIES.USER,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'user',
      resource_id: userId,
      resource_name: newData.email || `${newData.first_name} ${newData.last_name}`.trim(),
      old_value: this.sanitizeUserData(oldData),
      new_value: this.sanitizeUserData(newData),
      changed_fields: changedFields,
      status: 'success'
    });
  }

  /**
   * Log user deletion
   */
  logUserDeleted(req, user) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'user_deleted',
      action_category: CATEGORIES.USER,
      action_type: ACTION_TYPES.DELETE,
      resource_type: 'user',
      resource_id: user.user_id || user.id,
      resource_name: user.email,
      old_value: this.sanitizeUserData(user),
      status: 'success'
    });
  }

  /**
   * Log role assignment
   */
  logRoleAssigned(req, userId, oldRole, newRole) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'role_assigned',
      action_category: CATEGORIES.USER,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'user',
      resource_id: userId,
      old_value: { role: oldRole },
      new_value: { role: newRole },
      changed_fields: ['role'],
      status: 'success'
    });
  }

  /**
   * Sanitize user data (remove sensitive fields)
   */
  sanitizeUserData(userData) {
    if (!userData) return null;
    const { password, password_hash, refresh_token, ...sanitized } = userData;
    return sanitized;
  }

  // ==========================================
  // ASSET LOGGING
  // ==========================================

  /**
   * Log asset creation
   */
  logAssetCreated(req, asset) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'asset_created',
      action_category: CATEGORIES.ASSET,
      action_type: ACTION_TYPES.CREATE,
      resource_type: 'asset',
      resource_id: asset.asset_id || asset.id,
      resource_name: asset.asset_tag || asset.serial_number,
      new_value: asset,
      status: 'success'
    });
  }

  /**
   * Log asset update
   */
  logAssetUpdated(req, assetId, oldData, newData) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);
    const changedFields = this.getChangedFields(oldData, newData);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'asset_updated',
      action_category: CATEGORIES.ASSET,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'asset',
      resource_id: assetId,
      resource_name: newData.asset_tag || newData.serial_number,
      old_value: oldData,
      new_value: newData,
      changed_fields: changedFields,
      status: 'success'
    });
  }

  /**
   * Log asset deletion
   */
  logAssetDeleted(req, asset) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'asset_deleted',
      action_category: CATEGORIES.ASSET,
      action_type: ACTION_TYPES.DELETE,
      resource_type: 'asset',
      resource_id: asset.asset_id || asset.id,
      resource_name: asset.asset_tag,
      old_value: asset,
      status: 'success'
    });
  }

  /**
   * Log asset movement
   */
  logAssetMovement(req, assetId, movementData) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'asset_moved',
      action_category: CATEGORIES.ASSET,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'asset',
      resource_id: assetId,
      resource_name: movementData.asset_tag,
      new_value: movementData,
      metadata: {
        from_location: movementData.from_location_id,
        to_location: movementData.to_location_id,
        movement_type: movementData.movement_type
      },
      status: 'success'
    });
  }

  /**
   * Log asset assignment
   */
  logAssetAssigned(req, assetId, assignmentData) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'asset_assigned',
      action_category: CATEGORIES.ASSET,
      action_type: ACTION_TYPES.ASSIGN,
      resource_type: 'asset',
      resource_id: assetId,
      resource_name: assignmentData.asset_tag,
      new_value: assignmentData,
      metadata: {
        assigned_to: assignmentData.assigned_to_user_id,
        assignment_type: assignmentData.assignment_type
      },
      status: 'success'
    });
  }

  // ==========================================
  // TICKET LOGGING
  // ==========================================

  /**
   * Log ticket creation
   */
  logTicketCreated(req, ticket) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'ticket_created',
      action_category: CATEGORIES.TICKET,
      action_type: ACTION_TYPES.CREATE,
      resource_type: 'ticket',
      resource_id: ticket.ticket_id,
      resource_name: ticket.ticket_number,
      new_value: ticket,
      status: 'success'
    });
  }

  /**
   * Log ticket update
   */
  logTicketUpdated(req, ticketId, oldData, newData) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);
    const changedFields = this.getChangedFields(oldData, newData);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: 'ticket_updated',
      action_category: CATEGORIES.TICKET,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'ticket',
      resource_id: ticketId,
      resource_name: newData.ticket_number,
      old_value: oldData,
      new_value: newData,
      changed_fields: changedFields,
      status: 'success'
    });
  }

  /**
   * Log ticket status change
   */
  logTicketStatusChanged(req, ticketId, ticketNumber, oldStatus, newStatus) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'ticket_status_changed',
      action_category: CATEGORIES.TICKET,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'ticket',
      resource_id: ticketId,
      resource_name: ticketNumber,
      old_value: { status: oldStatus },
      new_value: { status: newStatus },
      changed_fields: ['status'],
      status: 'success'
    });
  }

  /**
   * Log ticket assignment
   */
  logTicketAssigned(req, ticketId, ticketNumber, engineerId, engineerName) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'ticket_assigned',
      action_category: CATEGORIES.TICKET,
      action_type: ACTION_TYPES.ASSIGN,
      resource_type: 'ticket',
      resource_id: ticketId,
      resource_name: ticketNumber,
      new_value: { assigned_to_engineer_id: engineerId, engineer_name: engineerName },
      status: 'success'
    });
  }

  /**
   * Log ticket closure
   */
  logTicketClosed(req, ticket, resolutionNotes) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'ticket_closed',
      action_category: CATEGORIES.TICKET,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'ticket',
      resource_id: ticket.ticket_id,
      resource_name: ticket.ticket_number,
      new_value: { status: 'closed', resolution_notes: resolutionNotes },
      status: 'success'
    });
  }

  // ==========================================
  // REQUISITION LOGGING
  // ==========================================

  /**
   * Log requisition creation
   */
  logRequisitionCreated(req, requisition) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'requisition_created',
      action_category: CATEGORIES.REQUISITION,
      action_type: ACTION_TYPES.CREATE,
      resource_type: 'requisition',
      resource_id: requisition.requisition_id,
      resource_name: requisition.requisition_number,
      new_value: requisition,
      status: 'success'
    });
  }

  /**
   * Log requisition approval
   */
  logRequisitionApproved(req, requisitionId, requisitionNumber, approverNotes) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'requisition_approved',
      action_category: CATEGORIES.REQUISITION,
      action_type: ACTION_TYPES.APPROVE,
      resource_type: 'requisition',
      resource_id: requisitionId,
      resource_name: requisitionNumber,
      new_value: { status: 'approved', approver_notes: approverNotes },
      status: 'success'
    });
  }

  /**
   * Log requisition rejection
   */
  logRequisitionRejected(req, requisitionId, requisitionNumber, rejectionReason) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'requisition_rejected',
      action_category: CATEGORIES.REQUISITION,
      action_type: ACTION_TYPES.REJECT,
      resource_type: 'requisition',
      resource_id: requisitionId,
      resource_name: requisitionNumber,
      new_value: { status: 'rejected', rejection_reason: rejectionReason },
      status: 'success'
    });
  }

  // ==========================================
  // PERMISSION LOGGING
  // ==========================================

  /**
   * Log permission granted
   */
  logPermissionGranted(req, userId, permission) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'permission_granted',
      action_category: CATEGORIES.PERMISSION,
      action_type: ACTION_TYPES.CREATE,
      resource_type: 'permission',
      resource_id: userId,
      new_value: { permission },
      status: 'success'
    });
  }

  /**
   * Log permission revoked
   */
  logPermissionRevoked(req, userId, permission) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'permission_revoked',
      action_category: CATEGORIES.PERMISSION,
      action_type: ACTION_TYPES.DELETE,
      resource_type: 'permission',
      resource_id: userId,
      old_value: { permission },
      status: 'success'
    });
  }

  // ==========================================
  // MASTER DATA LOGGING
  // ==========================================

  /**
   * Log master data change
   */
  logMasterDataChanged(req, entityType, entityId, action, oldData, newData) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);
    const changedFields = this.getChangedFields(oldData, newData);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action: `${entityType}_${action}`,
      action_category: CATEGORIES.MASTER,
      action_type: action.toUpperCase(),
      resource_type: entityType,
      resource_id: entityId,
      resource_name: newData?.name || oldData?.name || entityId,
      old_value: oldData,
      new_value: newData,
      changed_fields: changedFields,
      status: 'success'
    });
  }

  // ==========================================
  // SYSTEM SETTINGS LOGGING
  // ==========================================

  /**
   * Log settings change
   */
  logSettingsChanged(req, settingType, oldSettings, newSettings) {
    const userContext = this.extractUserContext(req);
    const changedFields = this.getChangedFields(oldSettings, newSettings);

    this.queueLog({
      ...userContext,
      action: 'settings_updated',
      action_category: CATEGORIES.SYSTEM,
      action_type: ACTION_TYPES.UPDATE,
      resource_type: 'settings',
      resource_id: settingType,
      resource_name: settingType,
      old_value: oldSettings,
      new_value: newSettings,
      changed_fields: changedFields,
      status: 'success'
    });
  }

  // ==========================================
  // FILE LOGGING
  // ==========================================

  /**
   * Log file upload
   */
  logFileUploaded(req, fileData) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'file_uploaded',
      action_category: CATEGORIES.FILE,
      action_type: ACTION_TYPES.CREATE,
      resource_type: 'file',
      resource_id: fileData.file_id || fileData.filename,
      resource_name: fileData.original_name || fileData.filename,
      new_value: {
        filename: fileData.filename,
        mimetype: fileData.mimetype,
        size: fileData.size
      },
      status: 'success'
    });
  }

  /**
   * Log file download
   */
  logFileDownloaded(req, fileData) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'file_downloaded',
      action_category: CATEGORIES.FILE,
      action_type: ACTION_TYPES.READ,
      resource_type: 'file',
      resource_id: fileData.file_id || fileData.filename,
      resource_name: fileData.original_name || fileData.filename,
      status: 'success'
    });
  }

  /**
   * Log file deletion
   */
  logFileDeleted(req, fileData) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'file_deleted',
      action_category: CATEGORIES.FILE,
      action_type: ACTION_TYPES.DELETE,
      resource_type: 'file',
      resource_id: fileData.file_id || fileData.filename,
      resource_name: fileData.original_name || fileData.filename,
      old_value: fileData,
      status: 'success'
    });
  }

  // ==========================================
  // JOB LOGGING
  // ==========================================

  /**
   * Log job execution
   */
  logJobExecution(jobName, status, details = {}) {
    this.queueLog({
      action: `job_${status}`,
      action_category: CATEGORIES.JOB,
      action_type: ACTION_TYPES.EXECUTE,
      resource_type: 'job',
      resource_id: jobName,
      resource_name: jobName,
      status: status === 'completed' ? 'success' : status,
      metadata: details,
      source_system: 'scheduler',
      client_type: 'system'
    });
  }

  // ==========================================
  // REPORT LOGGING
  // ==========================================

  /**
   * Log report generation
   */
  logReportGenerated(req, reportType, reportParams) {
    const userContext = this.extractUserContext(req);

    this.queueLog({
      ...userContext,
      action: 'report_generated',
      action_category: CATEGORIES.REPORT,
      action_type: ACTION_TYPES.EXPORT,
      resource_type: 'report',
      resource_id: reportType,
      resource_name: reportType,
      metadata: reportParams,
      status: 'success'
    });
  }

  // ==========================================
  // ERROR LOGGING
  // ==========================================

  /**
   * Log error/failure
   */
  logError(req, action, category, errorMessage, errorCode = null) {
    const userContext = this.extractUserContext(req);
    const requestContext = this.extractRequestContext(req);

    this.queueLog({
      ...userContext,
      ...requestContext,
      action,
      action_category: category,
      action_type: ACTION_TYPES.EXECUTE,
      status: 'error',
      error_message: errorMessage,
      error_code: errorCode
    });
  }

  // ==========================================
  // GENERIC LOGGING
  // ==========================================

  /**
   * Generic log method for custom events
   */
  log(req, options) {
    const userContext = req ? this.extractUserContext(req) : {};
    const requestContext = req ? this.extractRequestContext(req) : {};

    this.queueLog({
      ...userContext,
      ...requestContext,
      ...options,
      status: options.status || 'success'
    });
  }

  /**
   * Flush all queued logs immediately
   */
  async flush() {
    while (this.logQueue.length > 0) {
      await this.processQueue();
    }
  }
}

// Export singleton instance
const auditService = new AuditService();

module.exports = {
  auditService,
  CATEGORIES,
  ACTION_TYPES
};
