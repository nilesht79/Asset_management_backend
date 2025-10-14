/**
 * TICKET MODEL
 * Handles all database operations for the ticket management system
 */

const { connectDB, sql } = require('../config/database');

class TicketModel {
  /**
   * Generate unique ticket number
   * Format: TKT-YYYY-NNNN (e.g., TKT-2025-0001)
   */
  static async generateTicketNumber() {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .output('TicketNumber', sql.VarChar(20))
        .execute('sp_GenerateTicketNumber');

      return result.output.TicketNumber;
    } catch (error) {
      console.error('Error generating ticket number:', error);
      throw new Error('Failed to generate ticket number');
    }
  }

  /**
   * Create a new ticket
   * Department and Location are inherited from created_by_user_id
   */
  static async createTicket(ticketData) {
    try {
      const pool = await connectDB();

      // Step 1: Get employee's department and location
      const userQuery = `
        SELECT
          user_id,
          first_name,
          last_name,
          email,
          employee_id,
          department_id,
          location_id,
          role
        FROM USER_MASTER
        WHERE user_id = @userId AND is_active = 1
      `;

      const userResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, ticketData.created_by_user_id)
        .query(userQuery);

      if (userResult.recordset.length === 0) {
        throw new Error('User not found or inactive');
      }

      const employee = userResult.recordset[0];

      // Step 2: Generate ticket number
      const ticketNumber = await this.generateTicketNumber();

      // Step 3: Insert ticket with inherited dept/location
      const insertQuery = `
        INSERT INTO TICKETS (
          ticket_id,
          ticket_number,
          title,
          description,
          status,
          priority,
          created_by_user_id,
          created_by_coordinator_id,
          assigned_to_engineer_id,
          department_id,
          location_id,
          category,
          due_date,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @ticketNumber,
          @title,
          @description,
          @status,
          @priority,
          @createdByUserId,
          @createdByCoordinatorId,
          @assignedToEngineerId,
          @departmentId,
          @locationId,
          @category,
          @dueDate,
          GETDATE(),
          GETDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketNumber', sql.VarChar(20), ticketNumber)
        .input('title', sql.NVarChar(200), ticketData.title)
        .input('description', sql.NVarChar(sql.MAX), ticketData.description || null)
        .input('status', sql.VarChar(20), ticketData.status || 'open')
        .input('priority', sql.VarChar(20), ticketData.priority || 'medium')
        .input('createdByUserId', sql.UniqueIdentifier, ticketData.created_by_user_id)
        .input('createdByCoordinatorId', sql.UniqueIdentifier, ticketData.created_by_coordinator_id)
        .input('assignedToEngineerId', sql.UniqueIdentifier, ticketData.assigned_to_engineer_id || null)
        .input('departmentId', sql.UniqueIdentifier, employee.department_id)
        .input('locationId', sql.UniqueIdentifier, employee.location_id)
        .input('category', sql.NVarChar(100), ticketData.category || null)
        .input('dueDate', sql.DateTime, ticketData.due_date || null)
        .query(insertQuery);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating ticket:', error);
      throw error;
    }
  }

  /**
   * Get ticket by ID with all user details
   */
  static async getTicketById(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          t.*,
          -- Created By User (Employee)
          u1.first_name + ' ' + u1.last_name AS created_by_user_name,
          u1.email AS created_by_user_email,
          u1.employee_id AS created_by_user_employee_id,
          u1.role AS created_by_user_role,
          -- Coordinator
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email,
          u2.employee_id AS coordinator_employee_id,
          -- Engineer
          u3.first_name + ' ' + u3.last_name AS engineer_name,
          u3.email AS engineer_email,
          u3.employee_id AS engineer_employee_id,
          -- Department & Location
          d.department_name AS department_name,
          l.name AS location_name,
          l.address AS location_address
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN USER_MASTER u3 ON t.assigned_to_engineer_id = u3.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        WHERE t.ticket_id = @ticketId
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching ticket:', error);
      throw error;
    }
  }

  /**
   * Get tickets with filters and pagination
   */
  static async getTickets(filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();

      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      // Build WHERE clause based on filters
      if (filters.status) {
        whereClause += ' AND t.status = @status';
        params.status = filters.status;
      }

      if (filters.priority) {
        whereClause += ' AND t.priority = @priority';
        params.priority = filters.priority;
      }

      if (filters.category) {
        whereClause += ' AND t.category = @category';
        params.category = filters.category;
      }

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND t.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      if (filters.assigned_to_engineer_id) {
        whereClause += ' AND t.assigned_to_engineer_id = @assignedToEngineerId';
        params.assignedToEngineerId = filters.assigned_to_engineer_id;
      }

      if (filters.created_by_user_id) {
        whereClause += ' AND t.created_by_user_id = @createdByUserId';
        params.createdByUserId = filters.created_by_user_id;
      }

      if (filters.search) {
        whereClause += ` AND (
          t.ticket_number LIKE @search
          OR t.title LIKE @search
          OR t.description LIKE @search
          OR u1.first_name LIKE @search
          OR u1.last_name LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      // Main query
      const query = `
        SELECT
          t.*,
          -- Created By User (Employee)
          u1.first_name + ' ' + u1.last_name AS created_by_user_name,
          u1.email AS created_by_user_email,
          u1.employee_id AS created_by_user_employee_id,
          -- Coordinator
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email,
          -- Engineer
          u3.first_name + ' ' + u3.last_name AS engineer_name,
          u3.email AS engineer_email,
          u3.employee_id AS engineer_employee_id,
          -- Department & Location
          d.department_name AS department_name,
          l.name AS location_name
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN USER_MASTER u3 ON t.assigned_to_engineer_id = u3.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      // Count query
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        ${whereClause}
      `;

      // Execute queries
      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      // Add filter parameters
      Object.keys(params).forEach(key => {
        if (key === 'departmentId' || key === 'locationId' || key === 'assignedToEngineerId' || key === 'createdByUserId') {
          request.input(key, sql.UniqueIdentifier, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      const [ticketsResult, countResult] = await Promise.all([
        request.query(query),
        pool.request().query(countQuery.replace(whereClause, whereClause.split('AND').slice(0, -whereClause.split('AND').length + Object.keys(params).length + 1).join('AND')))
      ]);

      return {
        tickets: ticketsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0]?.total || 0,
          pages: Math.ceil((countResult.recordset[0]?.total || 0) / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching tickets:', error);
      throw error;
    }
  }

  /**
   * Update ticket
   */
  static async updateTicket(ticketId, updateData) {
    try {
      const pool = await connectDB();

      const allowedFields = [
        'title', 'description', 'status', 'priority',
        'category', 'due_date', 'assigned_to_engineer_id',
        'resolved_at', 'closed_at', 'resolution_notes'
      ];

      const updates = [];
      const params = { ticketId };

      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          updates.push(`${key} = @${key}`);
          params[key] = updateData[key];
        }
      });

      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }

      const query = `
        UPDATE TICKETS
        SET ${updates.join(', ')}, updated_at = GETDATE()
        WHERE ticket_id = @ticketId
      `;

      let request = pool.request();
      request.input('ticketId', sql.UniqueIdentifier, ticketId);

      Object.keys(params).forEach(key => {
        if (key !== 'ticketId') {
          if (key === 'assigned_to_engineer_id') {
            request.input(key, sql.UniqueIdentifier, params[key]);
          } else if (key === 'due_date' || key === 'resolved_at' || key === 'closed_at') {
            request.input(key, sql.DateTime, params[key]);
          } else if (key === 'description' || key === 'resolution_notes') {
            request.input(key, sql.NVarChar(sql.MAX), params[key]);
          } else {
            request.input(key, sql.NVarChar, params[key]);
          }
        }
      });

      await request.query(query);

      // Fetch and return the updated ticket
      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error updating ticket:', error);
      throw error;
    }
  }

  /**
   * Assign engineer to ticket
   */
  static async assignEngineer(ticketId, engineerId) {
    try {
      const pool = await connectDB();

      // Verify engineer exists and has correct role
      const engineerCheck = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT user_id, first_name, last_name, role, is_active
          FROM USER_MASTER
          WHERE user_id = @engineerId AND role = 'engineer' AND is_active = 1
        `);

      if (engineerCheck.recordset.length === 0) {
        throw new Error('Engineer not found or invalid');
      }

      // Update ticket - set status to in_progress when engineer is assigned
      await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          UPDATE TICKETS
          SET
            assigned_to_engineer_id = @engineerId,
            status = 'in_progress',
            updated_at = GETDATE()
          WHERE ticket_id = @ticketId
        `);

      // Fetch and return the updated ticket
      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error assigning engineer:', error);
      throw error;
    }
  }

  /**
   * Close ticket
   */
  static async closeTicket(ticketId, resolutionNotes) {
    try {
      const pool = await connectDB();

      // Update the ticket - set both resolved_at and closed_at
      await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('resolutionNotes', sql.NVarChar(sql.MAX), resolutionNotes)
        .query(`
          UPDATE TICKETS
          SET
            status = 'closed',
            resolved_at = CASE WHEN resolved_at IS NULL THEN GETDATE() ELSE resolved_at END,
            closed_at = GETDATE(),
            resolution_notes = @resolutionNotes,
            updated_at = GETDATE()
          WHERE ticket_id = @ticketId
        `);

      // Fetch and return the updated ticket
      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error closing ticket:', error);
      throw error;
    }
  }

  /**
   * Get available engineers (optionally filtered by department/location)
   */
  static async getAvailableEngineers(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE u.role = \'engineer\' AND u.is_active = 1';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND u.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND u.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      const query = `
        SELECT
          u.user_id,
          u.first_name + ' ' + u.last_name AS full_name,
          u.first_name,
          u.last_name,
          u.email,
          u.employee_id,
          u.department_id,
          u.location_id,
          d.department_name AS department_name,
          l.name AS location_name
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN locations l ON u.location_id = l.id
        ${whereClause}
        ORDER BY u.first_name, u.last_name
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching engineers:', error);
      throw error;
    }
  }

  /**
   * Get ticket statistics for dashboard
   */
  static async getTicketStats(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND location_id = @locationId';
        params.locationId = filters.location_id;
      }

      const query = `
        SELECT
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
          SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned_tickets,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tickets,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_tickets,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN priority = 'critical' OR priority = 'emergency' THEN 1 ELSE 0 END) AS critical_tickets,
          SUM(CASE WHEN due_date < GETDATE() AND status NOT IN ('closed', 'resolved') THEN 1 ELSE 0 END) AS overdue_tickets,
          SUM(CASE WHEN CAST(resolved_at AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS resolved_today
        FROM TICKETS
        ${whereClause}
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching ticket stats:', error);
      throw error;
    }
  }

  /**
   * Add comment to ticket
   */
  static async addComment(commentData) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO TICKET_COMMENTS (
          comment_id,
          ticket_id,
          user_id,
          comment_text,
          is_internal,
          created_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @ticketId,
          @userId,
          @commentText,
          @isInternal,
          GETDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, commentData.ticket_id)
        .input('userId', sql.UniqueIdentifier, commentData.user_id)
        .input('commentText', sql.NVarChar(sql.MAX), commentData.comment_text)
        .input('isInternal', sql.Bit, commentData.is_internal || false)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  /**
   * Get comments for a ticket
   */
  static async getComments(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          c.*,
          u.first_name + ' ' + u.last_name AS user_name,
          u.email AS user_email,
          u.role AS user_role
        FROM TICKET_COMMENTS c
        LEFT JOIN USER_MASTER u ON c.user_id = u.user_id
        WHERE c.ticket_id = @ticketId
        ORDER BY c.created_at ASC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching comments:', error);
      throw error;
    }
  }
}

module.exports = TicketModel;
