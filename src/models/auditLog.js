/**
 * AUDIT LOG MODEL
 * Database operations for the audit logging system
 */

const { executeAuditQuery, sql } = require('../config/auditDatabase');

class AuditLogModel {
  /**
   * Insert a new audit log entry
   * @param {Object} logData - Audit log data
   * @returns {Promise<Object|null>} Created audit log or null on failure
   */
  static async insertLog(logData) {
    return executeAuditQuery(async (pool) => {
      const query = `
        INSERT INTO AUDIT_LOGS (
          request_id, session_id,
          user_id, user_email, user_role, user_department_id,
          action, action_category, action_type,
          resource_type, resource_id, resource_name,
          http_method, endpoint, query_params,
          ip_address, user_agent, client_type,
          old_value, new_value, changed_fields,
          status, status_code, error_message, error_code,
          duration_ms, metadata, reason,
          source_system, api_version
        )
        OUTPUT INSERTED.audit_id
        VALUES (
          @request_id, @session_id,
          @user_id, @user_email, @user_role, @user_department_id,
          @action, @action_category, @action_type,
          @resource_type, @resource_id, @resource_name,
          @http_method, @endpoint, @query_params,
          @ip_address, @user_agent, @client_type,
          @old_value, @new_value, @changed_fields,
          @status, @status_code, @error_message, @error_code,
          @duration_ms, @metadata, @reason,
          @source_system, @api_version
        )
      `;

      const result = await pool.request()
        .input('request_id', sql.NVarChar(100), logData.request_id || null)
        .input('session_id', sql.NVarChar(100), logData.session_id || null)
        .input('user_id', sql.UniqueIdentifier, logData.user_id || null)
        .input('user_email', sql.NVarChar(255), logData.user_email || null)
        .input('user_role', sql.NVarChar(50), logData.user_role || null)
        .input('user_department_id', sql.UniqueIdentifier, logData.user_department_id || null)
        .input('action', sql.NVarChar(100), logData.action)
        .input('action_category', sql.NVarChar(50), logData.action_category)
        .input('action_type', sql.NVarChar(20), logData.action_type)
        .input('resource_type', sql.NVarChar(100), logData.resource_type || null)
        .input('resource_id', sql.NVarChar(100), logData.resource_id || null)
        .input('resource_name', sql.NVarChar(500), logData.resource_name || null)
        .input('http_method', sql.NVarChar(10), logData.http_method || null)
        .input('endpoint', sql.NVarChar(500), logData.endpoint || null)
        .input('query_params', sql.NVarChar(sql.MAX), logData.query_params ? JSON.stringify(logData.query_params) : null)
        .input('ip_address', sql.NVarChar(50), logData.ip_address || null)
        .input('user_agent', sql.NVarChar(1000), logData.user_agent || null)
        .input('client_type', sql.NVarChar(50), logData.client_type || 'web')
        .input('old_value', sql.NVarChar(sql.MAX), logData.old_value ? JSON.stringify(logData.old_value) : null)
        .input('new_value', sql.NVarChar(sql.MAX), logData.new_value ? JSON.stringify(logData.new_value) : null)
        .input('changed_fields', sql.NVarChar(sql.MAX), logData.changed_fields ? JSON.stringify(logData.changed_fields) : null)
        .input('status', sql.NVarChar(20), logData.status || 'success')
        .input('status_code', sql.Int, logData.status_code || null)
        .input('error_message', sql.NVarChar(sql.MAX), logData.error_message || null)
        .input('error_code', sql.NVarChar(50), logData.error_code || null)
        .input('duration_ms', sql.Int, logData.duration_ms || null)
        .input('metadata', sql.NVarChar(sql.MAX), logData.metadata ? JSON.stringify(logData.metadata) : null)
        .input('reason', sql.NVarChar(500), logData.reason || null)
        .input('source_system', sql.NVarChar(50), logData.source_system || 'api')
        .input('api_version', sql.NVarChar(20), logData.api_version || 'v1')
        .query(query);

      return { audit_id: result.recordset[0]?.audit_id };
    });
  }

  /**
   * Insert a login audit entry
   * @param {Object} loginData - Login audit data
   * @returns {Promise<Object|null>} Created login audit or null on failure
   */
  static async insertLoginAudit(loginData) {
    return executeAuditQuery(async (pool) => {
      const query = `
        INSERT INTO LOGIN_AUDIT (
          user_id, user_email, user_role,
          event_type, auth_method,
          ip_address, user_agent, device_info, location_info,
          session_id, token_id,
          status, failure_reason, metadata
        )
        OUTPUT INSERTED.login_audit_id
        VALUES (
          @user_id, @user_email, @user_role,
          @event_type, @auth_method,
          @ip_address, @user_agent, @device_info, @location_info,
          @session_id, @token_id,
          @status, @failure_reason, @metadata
        )
      `;

      const result = await pool.request()
        .input('user_id', sql.UniqueIdentifier, loginData.user_id || null)
        .input('user_email', sql.NVarChar(255), loginData.user_email || null)
        .input('user_role', sql.NVarChar(50), loginData.user_role || null)
        .input('event_type', sql.NVarChar(30), loginData.event_type)
        .input('auth_method', sql.NVarChar(30), loginData.auth_method || null)
        .input('ip_address', sql.NVarChar(50), loginData.ip_address || null)
        .input('user_agent', sql.NVarChar(1000), loginData.user_agent || null)
        .input('device_info', sql.NVarChar(500), loginData.device_info || null)
        .input('location_info', sql.NVarChar(500), loginData.location_info || null)
        .input('session_id', sql.NVarChar(100), loginData.session_id || null)
        .input('token_id', sql.NVarChar(100), loginData.token_id || null)
        .input('status', sql.NVarChar(20), loginData.status || 'success')
        .input('failure_reason', sql.NVarChar(500), loginData.failure_reason || null)
        .input('metadata', sql.NVarChar(sql.MAX), loginData.metadata ? JSON.stringify(loginData.metadata) : null)
        .query(query);

      return result.recordset[0];
    });
  }

  /**
   * Insert field-level data changes
   * @param {string} auditId - Parent audit log ID
   * @param {Array} changes - Array of field changes
   * @returns {Promise<number>} Number of changes inserted
   */
  static async insertDataChanges(auditId, changes) {
    if (!changes || changes.length === 0) return 0;

    return executeAuditQuery(async (pool) => {
      let inserted = 0;

      for (const change of changes) {
        await pool.request()
          .input('audit_id', sql.UniqueIdentifier, auditId)
          .input('table_name', sql.NVarChar(100), change.table_name)
          .input('record_id', sql.NVarChar(100), change.record_id)
          .input('field_name', sql.NVarChar(100), change.field_name)
          .input('old_value', sql.NVarChar(sql.MAX), change.old_value != null ? String(change.old_value) : null)
          .input('new_value', sql.NVarChar(sql.MAX), change.new_value != null ? String(change.new_value) : null)
          .input('data_type', sql.NVarChar(50), change.data_type || null)
          .query(`
            INSERT INTO DATA_CHANGE_AUDIT (audit_id, table_name, record_id, field_name, old_value, new_value, data_type)
            VALUES (@audit_id, @table_name, @record_id, @field_name, @old_value, @new_value, @data_type)
          `);
        inserted++;
      }

      return inserted;
    });
  }

  /**
   * Get audit logs with filters and pagination
   * @param {Object} filters - Filter options
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Logs and pagination info
   */
  static async getLogs(filters = {}, pagination = {}) {
    return executeAuditQuery(async (pool) => {
      const { page = 1, limit = 50 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      // Date range filter
      if (filters.start_date) {
        whereClause += ' AND created_at >= @start_date';
        params.start_date = filters.start_date;
      }
      if (filters.end_date) {
        whereClause += ' AND created_at <= @end_date';
        params.end_date = filters.end_date;
      }

      // User filter
      if (filters.user_id) {
        whereClause += ' AND user_id = @user_id';
        params.user_id = filters.user_id;
      }
      if (filters.user_email) {
        whereClause += ' AND user_email LIKE @user_email';
        params.user_email = `%${filters.user_email}%`;
      }

      // Action filters
      if (filters.action) {
        whereClause += ' AND action = @action';
        params.action = filters.action;
      }
      if (filters.action_category) {
        whereClause += ' AND action_category = @action_category';
        params.action_category = filters.action_category;
      }
      if (filters.action_type) {
        whereClause += ' AND action_type = @action_type';
        params.action_type = filters.action_type;
      }

      // Resource filters
      if (filters.resource_type) {
        whereClause += ' AND resource_type = @resource_type';
        params.resource_type = filters.resource_type;
      }
      if (filters.resource_id) {
        whereClause += ' AND resource_id = @resource_id';
        params.resource_id = filters.resource_id;
      }

      // Status filter
      if (filters.status) {
        whereClause += ' AND status = @status';
        params.status = filters.status;
      }

      // IP filter
      if (filters.ip_address) {
        whereClause += ' AND ip_address = @ip_address';
        params.ip_address = filters.ip_address;
      }

      // Search filter
      if (filters.search) {
        whereClause += ` AND (
          action LIKE @search
          OR resource_name LIKE @search
          OR user_email LIKE @search
          OR endpoint LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      const query = `
        SELECT
          audit_id, created_at, request_id,
          user_id, user_email, user_role,
          action, action_category, action_type,
          resource_type, resource_id, resource_name,
          http_method, endpoint,
          ip_address, client_type,
          status, status_code, error_message,
          duration_ms, source_system
        FROM AUDIT_LOGS
        ${whereClause}
        ORDER BY created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total
        FROM AUDIT_LOGS
        ${whereClause}
      `;

      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      // Add filter parameters
      Object.keys(params).forEach(key => {
        if (key === 'user_id') {
          request.input(key, sql.UniqueIdentifier, params[key]);
        } else if (key === 'start_date' || key === 'end_date') {
          request.input(key, sql.DateTime2, params[key]);
        } else {
          request.input(key, sql.NVarChar, params[key]);
        }
      });

      const [logsResult, countResult] = await Promise.all([
        request.query(query),
        pool.request()
          .input('start_date', sql.DateTime2, params.start_date || null)
          .input('end_date', sql.DateTime2, params.end_date || null)
          .input('user_id', sql.UniqueIdentifier, params.user_id || null)
          .input('user_email', sql.NVarChar, params.user_email || null)
          .input('action', sql.NVarChar, params.action || null)
          .input('action_category', sql.NVarChar, params.action_category || null)
          .input('action_type', sql.NVarChar, params.action_type || null)
          .input('resource_type', sql.NVarChar, params.resource_type || null)
          .input('resource_id', sql.NVarChar, params.resource_id || null)
          .input('status', sql.NVarChar, params.status || null)
          .input('ip_address', sql.NVarChar, params.ip_address || null)
          .input('search', sql.NVarChar, params.search || null)
          .query(countQuery)
      ]);

      const total = countResult.recordset[0]?.total || 0;

      return {
        logs: logsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    });
  }

  /**
   * Get a single audit log by ID with full details
   * @param {string} auditId - Audit log ID
   * @returns {Promise<Object|null>} Audit log details
   */
  static async getLogById(auditId) {
    return executeAuditQuery(async (pool) => {
      const logQuery = `
        SELECT * FROM AUDIT_LOGS WHERE audit_id = @audit_id
      `;

      const changesQuery = `
        SELECT * FROM DATA_CHANGE_AUDIT WHERE audit_id = @audit_id ORDER BY field_name
      `;

      const [logResult, changesResult] = await Promise.all([
        pool.request()
          .input('audit_id', sql.UniqueIdentifier, auditId)
          .query(logQuery),
        pool.request()
          .input('audit_id', sql.UniqueIdentifier, auditId)
          .query(changesQuery)
      ]);

      if (logResult.recordset.length === 0) {
        return null;
      }

      const log = logResult.recordset[0];

      // Parse JSON fields
      if (log.query_params) log.query_params = JSON.parse(log.query_params);
      if (log.old_value) log.old_value = JSON.parse(log.old_value);
      if (log.new_value) log.new_value = JSON.parse(log.new_value);
      if (log.changed_fields) log.changed_fields = JSON.parse(log.changed_fields);
      if (log.metadata) log.metadata = JSON.parse(log.metadata);

      log.field_changes = changesResult.recordset;

      return log;
    });
  }

  /**
   * Get login audit logs
   * @param {Object} filters - Filter options
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Login logs and pagination
   */
  static async getLoginLogs(filters = {}, pagination = {}) {
    return executeAuditQuery(async (pool) => {
      const { page = 1, limit = 50 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.start_date) {
        whereClause += ' AND created_at >= @start_date';
        params.start_date = filters.start_date;
      }
      if (filters.end_date) {
        whereClause += ' AND created_at <= @end_date';
        params.end_date = filters.end_date;
      }
      if (filters.user_id) {
        whereClause += ' AND user_id = @user_id';
        params.user_id = filters.user_id;
      }
      if (filters.event_type) {
        whereClause += ' AND event_type = @event_type';
        params.event_type = filters.event_type;
      }
      if (filters.status) {
        whereClause += ' AND status = @status';
        params.status = filters.status;
      }
      if (filters.ip_address) {
        whereClause += ' AND ip_address = @ip_address';
        params.ip_address = filters.ip_address;
      }

      const query = `
        SELECT *
        FROM LOGIN_AUDIT
        ${whereClause}
        ORDER BY created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total FROM LOGIN_AUDIT ${whereClause}
      `;

      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      Object.keys(params).forEach(key => {
        if (key === 'user_id') {
          request.input(key, sql.UniqueIdentifier, params[key]);
        } else if (key === 'start_date' || key === 'end_date') {
          request.input(key, sql.DateTime2, params[key]);
        } else {
          request.input(key, sql.NVarChar, params[key]);
        }
      });

      const [logsResult, countResult] = await Promise.all([
        request.query(query),
        pool.request()
          .input('start_date', sql.DateTime2, params.start_date || null)
          .input('end_date', sql.DateTime2, params.end_date || null)
          .input('user_id', sql.UniqueIdentifier, params.user_id || null)
          .input('event_type', sql.NVarChar, params.event_type || null)
          .input('status', sql.NVarChar, params.status || null)
          .input('ip_address', sql.NVarChar, params.ip_address || null)
          .query(countQuery)
      ]);

      const total = countResult.recordset[0]?.total || 0;

      return {
        logs: logsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    });
  }

  /**
   * Get audit statistics for dashboard
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Statistics
   */
  static async getStatistics(filters = {}) {
    return executeAuditQuery(async (pool) => {
      const dateFilter = filters.days ? `WHERE created_at >= DATEADD(DAY, -${parseInt(filters.days)}, GETDATE())` : '';

      const queries = {
        // Overall counts
        overview: `
          SELECT
            COUNT(*) AS total_logs,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
            COUNT(DISTINCT user_id) AS unique_users,
            COUNT(DISTINCT ip_address) AS unique_ips,
            AVG(duration_ms) AS avg_duration_ms
          FROM AUDIT_LOGS
          ${dateFilter}
        `,
        // By category
        byCategory: `
          SELECT
            action_category,
            COUNT(*) AS count,
            SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failures
          FROM AUDIT_LOGS
          ${dateFilter}
          GROUP BY action_category
          ORDER BY count DESC
        `,
        // By action type
        byActionType: `
          SELECT
            action_type,
            COUNT(*) AS count
          FROM AUDIT_LOGS
          ${dateFilter}
          GROUP BY action_type
          ORDER BY count DESC
        `,
        // Top actions
        topActions: `
          SELECT TOP 10
            action,
            COUNT(*) AS count,
            AVG(duration_ms) AS avg_duration
          FROM AUDIT_LOGS
          ${dateFilter}
          GROUP BY action
          ORDER BY count DESC
        `,
        // Recent failures
        recentFailures: `
          SELECT TOP 10
            created_at,
            user_email,
            action,
            endpoint,
            error_message,
            ip_address
          FROM AUDIT_LOGS
          WHERE status != 'success'
          ${dateFilter ? 'AND ' + dateFilter.replace('WHERE ', '') : ''}
          ORDER BY created_at DESC
        `,
        // Login stats
        loginStats: `
          SELECT
            event_type,
            status,
            COUNT(*) AS count
          FROM LOGIN_AUDIT
          ${dateFilter}
          GROUP BY event_type, status
          ORDER BY count DESC
        `,
        // Hourly distribution (last 24 hours)
        hourlyDistribution: `
          SELECT
            DATEPART(HOUR, created_at) AS hour,
            COUNT(*) AS count
          FROM AUDIT_LOGS
          WHERE created_at >= DATEADD(HOUR, -24, GETDATE())
          GROUP BY DATEPART(HOUR, created_at)
          ORDER BY hour
        `
      };

      const [
        overviewResult,
        byCategoryResult,
        byActionTypeResult,
        topActionsResult,
        recentFailuresResult,
        loginStatsResult,
        hourlyResult
      ] = await Promise.all([
        pool.request().query(queries.overview),
        pool.request().query(queries.byCategory),
        pool.request().query(queries.byActionType),
        pool.request().query(queries.topActions),
        pool.request().query(queries.recentFailures),
        pool.request().query(queries.loginStats),
        pool.request().query(queries.hourlyDistribution)
      ]);

      return {
        overview: overviewResult.recordset[0],
        by_category: byCategoryResult.recordset,
        by_action_type: byActionTypeResult.recordset,
        top_actions: topActionsResult.recordset,
        recent_failures: recentFailuresResult.recordset,
        login_stats: loginStatsResult.recordset,
        hourly_distribution: hourlyResult.recordset
      };
    });
  }

  /**
   * Get user activity timeline
   * @param {string} userId - User ID
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} User activity logs
   */
  static async getUserActivity(userId, pagination = {}) {
    return executeAuditQuery(async (pool) => {
      const { page = 1, limit = 50 } = pagination;
      const offset = (page - 1) * limit;

      const query = `
        SELECT
          audit_id, created_at,
          action, action_category, action_type,
          resource_type, resource_id, resource_name,
          http_method, endpoint,
          ip_address, status, duration_ms
        FROM AUDIT_LOGS
        WHERE user_id = @user_id
        ORDER BY created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total FROM AUDIT_LOGS WHERE user_id = @user_id
      `;

      const [logsResult, countResult] = await Promise.all([
        pool.request()
          .input('user_id', sql.UniqueIdentifier, userId)
          .input('offset', sql.Int, offset)
          .input('limit', sql.Int, limit)
          .query(query),
        pool.request()
          .input('user_id', sql.UniqueIdentifier, userId)
          .query(countQuery)
      ]);

      const total = countResult.recordset[0]?.total || 0;

      return {
        logs: logsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    });
  }

  /**
   * Get resource history
   * @param {string} resourceType - Resource type
   * @param {string} resourceId - Resource ID
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Resource history logs
   */
  static async getResourceHistory(resourceType, resourceId, pagination = {}) {
    return executeAuditQuery(async (pool) => {
      const { page = 1, limit = 50 } = pagination;
      const offset = (page - 1) * limit;

      const query = `
        SELECT
          audit_id, created_at,
          user_id, user_email, user_role,
          action, action_type,
          old_value, new_value, changed_fields,
          status, reason
        FROM AUDIT_LOGS
        WHERE resource_type = @resource_type AND resource_id = @resource_id
        ORDER BY created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total
        FROM AUDIT_LOGS
        WHERE resource_type = @resource_type AND resource_id = @resource_id
      `;

      const [logsResult, countResult] = await Promise.all([
        pool.request()
          .input('resource_type', sql.NVarChar(100), resourceType)
          .input('resource_id', sql.NVarChar(100), resourceId)
          .input('offset', sql.Int, offset)
          .input('limit', sql.Int, limit)
          .query(query),
        pool.request()
          .input('resource_type', sql.NVarChar(100), resourceType)
          .input('resource_id', sql.NVarChar(100), resourceId)
          .query(countQuery)
      ]);

      const total = countResult.recordset[0]?.total || 0;

      // Parse JSON fields
      const logs = logsResult.recordset.map(log => {
        if (log.old_value) log.old_value = JSON.parse(log.old_value);
        if (log.new_value) log.new_value = JSON.parse(log.new_value);
        if (log.changed_fields) log.changed_fields = JSON.parse(log.changed_fields);
        return log;
      });

      return {
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    });
  }

  /**
   * Run archive job
   * @returns {Promise<Object>} Archive results
   */
  static async runArchiveJob() {
    return executeAuditQuery(async (pool) => {
      const result = await pool.request().execute('sp_ArchiveAuditLogs');
      return result.recordset[0];
    });
  }

  /**
   * Generate daily summary
   * @param {Date} date - Date for summary (default: today)
   * @param {boolean} generateAll - If true, generate for all dates missing summaries
   * @returns {Promise<Object>} Summary generation result
   */
  static async generateDailySummary(date = null, generateAll = false) {
    return executeAuditQuery(async (pool) => {
      if (generateAll) {
        // Generate summaries for all dates that have audit logs but no summaries
        const result = await pool.request().query(`
          DECLARE @dates_processed INT = 0;
          DECLARE @total_entries INT = 0;

          -- Get all dates with audit logs that don't have summaries
          DECLARE @dates TABLE (log_date DATE);
          INSERT INTO @dates
          SELECT DISTINCT CAST(created_at AS DATE) AS log_date
          FROM AUDIT_LOGS
          WHERE CAST(created_at AS DATE) NOT IN (
            SELECT DISTINCT summary_date FROM AUDIT_SUMMARY_DAILY
          );

          -- Generate summary for each date
          DECLARE @current_date DATE;
          DECLARE date_cursor CURSOR FOR SELECT log_date FROM @dates;
          OPEN date_cursor;
          FETCH NEXT FROM date_cursor INTO @current_date;

          WHILE @@FETCH_STATUS = 0
          BEGIN
            INSERT INTO AUDIT_SUMMARY_DAILY (
              summary_date, action_category, action,
              total_count, success_count, failure_count,
              unique_users, unique_ips,
              avg_duration_ms, max_duration_ms
            )
            SELECT
              @current_date,
              action_category,
              action,
              COUNT(*) AS total_count,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failure_count,
              COUNT(DISTINCT user_id) AS unique_users,
              COUNT(DISTINCT ip_address) AS unique_ips,
              AVG(duration_ms) AS avg_duration_ms,
              MAX(duration_ms) AS max_duration_ms
            FROM AUDIT_LOGS
            WHERE CAST(created_at AS DATE) = @current_date
            GROUP BY action_category, action;

            SET @total_entries = @total_entries + @@ROWCOUNT;
            SET @dates_processed = @dates_processed + 1;

            FETCH NEXT FROM date_cursor INTO @current_date;
          END

          CLOSE date_cursor;
          DEALLOCATE date_cursor;

          SELECT @dates_processed AS dates_processed, @total_entries AS summaries_created;
        `);
        return result.recordset[0];
      }

      // Generate for specific date (default: today instead of yesterday)
      const summaryDate = date || new Date();

      // First, check if there are any logs for this date
      const checkResult = await pool.request()
        .input('summary_date', sql.Date, summaryDate)
        .query(`
          SELECT COUNT(*) AS log_count
          FROM AUDIT_LOGS
          WHERE CAST(created_at AS DATE) = @summary_date
        `);

      const logCount = checkResult.recordset[0].log_count;

      if (logCount === 0) {
        return {
          summaries_created: 0,
          message: 'No audit logs found for the specified date',
          date: summaryDate
        };
      }

      // Delete existing summary for the date and regenerate
      await pool.request()
        .input('summary_date', sql.Date, summaryDate)
        .query(`DELETE FROM AUDIT_SUMMARY_DAILY WHERE summary_date = @summary_date`);

      const result = await pool.request()
        .input('summary_date', sql.Date, summaryDate)
        .query(`
          INSERT INTO AUDIT_SUMMARY_DAILY (
            summary_date, action_category, action,
            total_count, success_count, failure_count,
            unique_users, unique_ips,
            avg_duration_ms, max_duration_ms
          )
          SELECT
            @summary_date,
            action_category,
            action,
            COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failure_count,
            COUNT(DISTINCT user_id) AS unique_users,
            COUNT(DISTINCT ip_address) AS unique_ips,
            AVG(duration_ms) AS avg_duration_ms,
            MAX(duration_ms) AS max_duration_ms
          FROM AUDIT_LOGS
          WHERE CAST(created_at AS DATE) = @summary_date
          GROUP BY action_category, action;

          SELECT @@ROWCOUNT AS summaries_created;
        `);

      return {
        ...result.recordset[0],
        date: summaryDate,
        logs_processed: logCount
      };
    });
  }

  /**
   * Get retention configuration
   * @returns {Promise<Array>} Retention policies
   */
  static async getRetentionConfig() {
    return executeAuditQuery(async (pool) => {
      const result = await pool.request().query(`
        SELECT * FROM AUDIT_RETENTION_CONFIG WHERE is_active = 1 ORDER BY action_category
      `);
      return result.recordset;
    });
  }

  /**
   * Update retention configuration
   * @param {string} category - Action category
   * @param {Object} config - New configuration
   * @returns {Promise<Object>} Updated config
   */
  static async updateRetentionConfig(category, config, updatedBy) {
    return executeAuditQuery(async (pool) => {
      const result = await pool.request()
        .input('action_category', sql.NVarChar(50), category)
        .input('retention_days', sql.Int, config.retention_days)
        .input('archive_days', sql.Int, config.archive_days)
        .input('updated_by', sql.UniqueIdentifier, updatedBy)
        .query(`
          UPDATE AUDIT_RETENTION_CONFIG
          SET retention_days = @retention_days,
              archive_days = @archive_days,
              updated_by = @updated_by,
              updated_at = GETDATE()
          WHERE action_category = @action_category;

          SELECT * FROM AUDIT_RETENTION_CONFIG WHERE action_category = @action_category;
        `);
      return result.recordset[0];
    });
  }

  /**
   * Get daily summaries
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Daily summaries
   */
  static async getDailySummaries(filters = {}) {
    return executeAuditQuery(async (pool) => {
      const days = filters.days || 30;

      const result = await pool.request()
        .input('days', sql.Int, days)
        .query(`
          SELECT
            summary_date,
            SUM(total_count) AS total_count,
            SUM(success_count) AS success_count,
            SUM(failure_count) AS failure_count,
            SUM(unique_users) AS unique_users,
            AVG(avg_duration_ms) AS avg_duration_ms
          FROM AUDIT_SUMMARY_DAILY
          WHERE summary_date >= DATEADD(DAY, -@days, GETDATE())
          GROUP BY summary_date
          ORDER BY summary_date DESC
        `);

      return result.recordset;
    });
  }

  /**
   * Export audit logs to CSV format
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Logs for export
   */
  static async exportLogs(filters = {}) {
    return executeAuditQuery(async (pool) => {
      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.start_date) {
        whereClause += ' AND created_at >= @start_date';
        params.start_date = filters.start_date;
      }
      if (filters.end_date) {
        whereClause += ' AND created_at <= @end_date';
        params.end_date = filters.end_date;
      }
      if (filters.action_category) {
        whereClause += ' AND action_category = @action_category';
        params.action_category = filters.action_category;
      }

      const request = pool.request();

      // Add parameters safely
      if (params.start_date) {
        request.input('start_date', sql.DateTime2, params.start_date);
      }
      if (params.end_date) {
        request.input('end_date', sql.DateTime2, params.end_date);
      }
      if (params.action_category) {
        request.input('action_category', sql.NVarChar(50), params.action_category);
      }

      const result = await request.query(`
        SELECT
          created_at,
          user_email,
          user_role,
          action,
          action_category,
          action_type,
          resource_type,
          resource_id,
          resource_name,
          http_method,
          endpoint,
          ip_address,
          status,
          status_code,
          error_message,
          duration_ms
        FROM AUDIT_LOGS
        ${whereClause}
        ORDER BY created_at DESC
      `);

      return result.recordset;
    });
  }
}

module.exports = AuditLogModel;
