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
          ticket_type,
          service_type,
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
          @ticketType,
          @serviceType,
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
        .input('ticketType', sql.NVarChar(30), ticketData.ticket_type || 'internal')
        .input('serviceType', sql.VarChar(20), ticketData.service_type || 'general')
        .input('dueDate', sql.DateTime, ticketData.due_date || null)
        .query(insertQuery);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating ticket:', error);
      throw error;
    }
  }

  /**
   * Create a new guest ticket
   * Guest tickets don't have associated user, department, or location
   */
  static async createGuestTicket(ticketData, guestData) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        // Step 1: Generate ticket number
        const ticketNumberResult = await transaction.request()
          .output('TicketNumber', sql.VarChar(20))
          .execute('sp_GenerateTicketNumber');

        const ticketNumber = ticketNumberResult.output.TicketNumber;

        // Step 2: Insert ticket with is_guest=1, created_by_user_id=NULL
        const insertTicketQuery = `
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
            ticket_type,
            service_type,
            due_date,
            is_guest,
            created_at,
            updated_at
          )
          OUTPUT INSERTED.ticket_id
          VALUES (
            NEWID(),
            @ticketNumber,
            @title,
            @description,
            @status,
            @priority,
            NULL,
            @createdByCoordinatorId,
            @assignedToEngineerId,
            NULL,
            NULL,
            @category,
            @ticketType,
            @serviceType,
            @dueDate,
            1,
            GETDATE(),
            GETDATE()
          )
        `;

        const ticketResult = await transaction.request()
          .input('ticketNumber', sql.VarChar(20), ticketNumber)
          .input('title', sql.NVarChar(200), ticketData.title)
          .input('description', sql.NVarChar(sql.MAX), ticketData.description || null)
          .input('status', sql.VarChar(20), ticketData.status || 'open')
          .input('priority', sql.VarChar(20), ticketData.priority || 'medium')
          .input('createdByCoordinatorId', sql.UniqueIdentifier, ticketData.created_by_coordinator_id)
          .input('assignedToEngineerId', sql.UniqueIdentifier, ticketData.assigned_to_engineer_id || null)
          .input('category', sql.NVarChar(100), ticketData.category || null)
          .input('ticketType', sql.NVarChar(30), ticketData.ticket_type || 'external')
          .input('serviceType', sql.VarChar(20), ticketData.service_type || 'general')
          .input('dueDate', sql.DateTime, ticketData.due_date || null)
          .query(insertTicketQuery);

        const ticketId = ticketResult.recordset[0].ticket_id;

        // Step 3: Insert guest information
        const insertGuestQuery = `
          INSERT INTO GUEST_TICKETS (
            guest_ticket_id,
            ticket_id,
            guest_name,
            guest_email,
            guest_phone,
            created_at,
            updated_at
          )
          VALUES (
            NEWID(),
            @ticketId,
            @guestName,
            @guestEmail,
            @guestPhone,
            GETDATE(),
            GETDATE()
          )
        `;

        await transaction.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .input('guestName', sql.NVarChar(100), guestData.guest_name)
          .input('guestEmail', sql.NVarChar(255), guestData.guest_email)
          .input('guestPhone', sql.NVarChar(20), guestData.guest_phone || null)
          .query(insertGuestQuery);

        await transaction.commit();

        return { ticket_id: ticketId };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error creating guest ticket:', error);
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
          l.address AS location_address,
          -- Guest Information
          gt.guest_name,
          gt.guest_email,
          gt.guest_phone
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN USER_MASTER u3 ON t.assigned_to_engineer_id = u3.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
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

      // Add is_guest filter if provided
      if (filters.is_guest !== undefined) {
        whereClause += ' AND t.is_guest = @isGuest';
        params.isGuest = filters.is_guest;
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
          l.name AS location_name,
          -- Guest Information
          gt.guest_name,
          gt.guest_email,
          gt.guest_phone
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN USER_MASTER u3 ON t.assigned_to_engineer_id = u3.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
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
          SUM(CASE WHEN CAST(closed_at AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS closed_today
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

  /**
   * Get dynamic filter options based on existing data
   * Returns only values that exist in the database
   */
  static async getFilterOptions() {
    try {
      const pool = await connectDB();

      // Get distinct statuses
      const statusQuery = `
        SELECT DISTINCT status
        FROM TICKETS
        WHERE status IS NOT NULL
        ORDER BY status
      `;

      // Get distinct priorities with custom order
      const priorityQuery = `
        SELECT DISTINCT priority,
          CASE priority
            WHEN 'emergency' THEN 1
            WHEN 'critical' THEN 2
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 4
            WHEN 'low' THEN 5
            ELSE 6
          END AS priority_order
        FROM TICKETS
        WHERE priority IS NOT NULL
        ORDER BY priority_order
      `;

      // Get distinct categories
      const categoryQuery = `
        SELECT DISTINCT category
        FROM TICKETS
        WHERE category IS NOT NULL
        ORDER BY category
      `;

      // Get departments that have tickets
      const departmentQuery = `
        SELECT DISTINCT d.department_id, d.department_name
        FROM DEPARTMENT_MASTER d
        INNER JOIN TICKETS t ON d.department_id = t.department_id
        WHERE d.department_name IS NOT NULL
        ORDER BY d.department_name
      `;

      // Get locations that have tickets
      const locationQuery = `
        SELECT DISTINCT l.id, l.name
        FROM locations l
        INNER JOIN TICKETS t ON l.id = t.location_id
        WHERE l.name IS NOT NULL
        ORDER BY l.name
      `;

      // Get engineers who are assigned or available
      const engineerQuery = `
        SELECT DISTINCT
          u.user_id,
          u.first_name + ' ' + u.last_name AS full_name,
          u.email,
          d.department_name
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        WHERE u.role = 'engineer' AND u.is_active = 1
        ORDER BY full_name
      `;

      // Execute all queries
      const [
        statusResult,
        priorityResult,
        categoryResult,
        departmentResult,
        locationResult,
        engineerResult
      ] = await Promise.all([
        pool.request().query(statusQuery),
        pool.request().query(priorityQuery),
        pool.request().query(categoryQuery),
        pool.request().query(departmentQuery),
        pool.request().query(locationQuery),
        pool.request().query(engineerQuery)
      ]);

      return {
        statuses: statusResult.recordset.map(r => r.status),
        priorities: priorityResult.recordset.map(r => r.priority),
        categories: categoryResult.recordset.map(r => r.category),
        departments: departmentResult.recordset.map(r => ({
          id: r.department_id,
          name: r.department_name
        })),
        locations: locationResult.recordset.map(r => ({
          id: r.id,
          name: r.name
        })),
        engineers: engineerResult.recordset.map(r => ({
          id: r.user_id,
          name: r.full_name,
          email: r.email,
          department: r.department_name
        }))
      };
    } catch (error) {
      console.error('Error fetching filter options:', error);
      throw error;
    }
  }

  /**
   * Get tickets assigned to a specific engineer
   */
  static async getEngineerTickets(engineerId, filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();

      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE t.assigned_to_engineer_id = @engineerId';
      const params = { engineerId };

      // Build WHERE clause based on filters
      if (filters.status) {
        whereClause += ' AND t.status = @status';
        params.status = filters.status;
      }

      if (filters.priority) {
        whereClause += ' AND t.priority = @priority';
        params.priority = filters.priority;
      }

      if (filters.search) {
        whereClause += ` AND (
          t.ticket_number LIKE @search
          OR t.title LIKE @search
          OR t.description LIKE @search
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
          -- Coordinator
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email,
          -- Department & Location
          d.department_name AS department_name,
          l.name AS location_name,
          -- Guest Information
          gt.guest_name,
          gt.guest_email,
          gt.guest_phone,
          -- Close Request Information
          cr.close_request_id,
          cr.request_notes AS close_request_notes,
          cr.request_status AS close_request_status,
          cr.created_at AS close_request_created_at
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
        LEFT JOIN TICKET_CLOSE_REQUESTS cr ON t.ticket_id = cr.ticket_id AND cr.request_status = 'pending'
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      // Count query
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM TICKETS t
        ${whereClause}
      `;

      // Execute queries
      let request = pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      // Add filter parameters
      Object.keys(params).forEach(key => {
        if (key !== 'engineerId') {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      const [ticketsResult, countResult] = await Promise.all([
        request.query(query),
        pool.request()
          .input('engineerId', sql.UniqueIdentifier, engineerId)
          .query(countQuery)
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
      console.error('Error fetching engineer tickets:', error);
      throw error;
    }
  }

  /**
   * Engineer requests to close a ticket
   */
  static async requestTicketClose(ticketId, engineerId, requestNotes) {
    try {
      const pool = await connectDB();

      // Check if ticket exists and is assigned to this engineer
      const ticketCheck = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT ticket_id, status, assigned_to_engineer_id
          FROM TICKETS
          WHERE ticket_id = @ticketId
        `);

      if (ticketCheck.recordset.length === 0) {
        throw new Error('Ticket not found');
      }

      const ticket = ticketCheck.recordset[0];

      if (!ticket.assigned_to_engineer_id || ticket.assigned_to_engineer_id !== engineerId) {
        throw new Error('Ticket is not assigned to this engineer');
      }

      if (ticket.status === 'closed' || ticket.status === 'cancelled') {
        throw new Error('Ticket is already closed');
      }

      if (ticket.status === 'pending_closure') {
        throw new Error('Close request already exists for this ticket');
      }

      // Create close request
      const insertQuery = `
        INSERT INTO TICKET_CLOSE_REQUESTS (
          close_request_id,
          ticket_id,
          requested_by_engineer_id,
          request_notes,
          request_status,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @ticketId,
          @engineerId,
          @requestNotes,
          'pending',
          GETDATE(),
          GETDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .input('requestNotes', sql.NVarChar(sql.MAX), requestNotes)
        .query(insertQuery);

      // Update ticket status to pending_closure
      await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          UPDATE TICKETS
          SET status = 'pending_closure', updated_at = GETDATE()
          WHERE ticket_id = @ticketId
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error requesting ticket close:', error);
      throw error;
    }
  }

  /**
   * Get pending close requests for coordinators
   */
  static async getPendingCloseRequests(filters = {}) {
    try {
      const pool = await connectDB();

      // Only get requests that are pending AND ticket is still pending_closure
      let whereClause = 'WHERE cr.request_status = \'pending\' AND t.status = \'pending_closure\'';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND t.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      const query = `
        SELECT
          cr.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.status AS ticket_status,
          t.priority AS ticket_priority,
          t.department_id,
          t.location_id,
          -- Engineer who requested
          u1.first_name + ' ' + u1.last_name AS engineer_name,
          u1.email AS engineer_email,
          -- Created By User
          u2.first_name + ' ' + u2.last_name AS created_by_user_name,
          u2.email AS created_by_user_email,
          -- Department & Location
          d.department_name,
          l.name AS location_name,
          -- Guest Info
          gt.guest_name,
          gt.guest_email
        FROM TICKET_CLOSE_REQUESTS cr
        INNER JOIN TICKETS t ON cr.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u1 ON cr.requested_by_engineer_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_user_id = u2.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
        ${whereClause}
        ORDER BY cr.created_at ASC
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching pending close requests:', error);
      throw error;
    }
  }

  /**
   * Get close request count (for badge)
   */
  static async getCloseRequestCount(filters = {}) {
    try {
      const pool = await connectDB();

      // Only count requests that are pending AND ticket is still pending_closure
      let whereClause = 'WHERE cr.request_status = \'pending\' AND t.status = \'pending_closure\'';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      const query = `
        SELECT COUNT(*) AS count
        FROM TICKET_CLOSE_REQUESTS cr
        INNER JOIN TICKETS t ON cr.ticket_id = t.ticket_id
        ${whereClause}
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset[0].count;
    } catch (error) {
      console.error('Error fetching close request count:', error);
      throw error;
    }
  }

  /**
   * Coordinator approves or rejects close request
   */
  static async reviewCloseRequest(closeRequestId, coordinatorId, action, reviewNotes = null) {
    try {
      const pool = await connectDB();

      // Get close request and ticket details
      const requestCheck = await pool.request()
        .input('closeRequestId', sql.UniqueIdentifier, closeRequestId)
        .query(`
          SELECT
            cr.*,
            t.ticket_id as ticket_id_from_tickets,
            t.status as ticket_status_current
          FROM TICKET_CLOSE_REQUESTS cr
          INNER JOIN TICKETS t ON cr.ticket_id = t.ticket_id
          WHERE cr.close_request_id = @closeRequestId
        `);

      if (requestCheck.recordset.length === 0) {
        throw new Error('Close request not found');
      }

      const closeRequest = requestCheck.recordset[0];

      if (closeRequest.request_status !== 'pending') {
        const status = closeRequest.request_status;
        throw new Error(`Close request has already been ${status}. Please refresh the list.`);
      }

      // Double-check ticket status
      if (closeRequest.ticket_status_current !== 'pending_closure') {
        throw new Error('Ticket is no longer in pending_closure state. Please refresh the list.');
      }

      // Use the ticket_id from the close request
      const ticketId = closeRequest.ticket_id;

      // Validation: Ensure ticketId is valid
      if (!ticketId) {
        console.error('Missing ticket_id in close request:', closeRequest);
        throw new Error('Invalid close request data: missing ticket_id');
      }

      console.log(`Processing close request ${closeRequestId} for ticket ${ticketId}, action: ${action}`);

      // Update close request
      await pool.request()
        .input('closeRequestId', sql.UniqueIdentifier, closeRequestId)
        .input('coordinatorId', sql.UniqueIdentifier, coordinatorId)
        .input('action', sql.VarChar, action)
        .input('reviewNotes', sql.NVarChar(sql.MAX), reviewNotes)
        .query(`
          UPDATE TICKET_CLOSE_REQUESTS
          SET
            request_status = @action,
            reviewed_by_coordinator_id = @coordinatorId,
            review_notes = @reviewNotes,
            reviewed_at = GETDATE(),
            updated_at = GETDATE()
          WHERE close_request_id = @closeRequestId
        `);

      // Update ticket based on action
      if (action === 'approved') {
        // Close the ticket
        await pool.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .input('resolutionNotes', sql.NVarChar(sql.MAX), closeRequest.request_notes)
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
      } else if (action === 'rejected') {
        // Return ticket to in_progress
        await pool.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .query(`
            UPDATE TICKETS
            SET
              status = 'in_progress',
              updated_at = GETDATE()
            WHERE ticket_id = @ticketId
          `);
      }

      console.log(`Successfully ${action} close request ${closeRequestId}, ticket ${ticketId} status updated`);

      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error reviewing close request:', error);
      throw error;
    }
  }

  /**
   * Get close request history for a ticket
   */
  static async getCloseRequestHistory(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          cr.*,
          u1.first_name + ' ' + u1.last_name AS engineer_name,
          u1.email AS engineer_email,
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email
        FROM TICKET_CLOSE_REQUESTS cr
        LEFT JOIN USER_MASTER u1 ON cr.requested_by_engineer_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON cr.reviewed_by_coordinator_id = u2.user_id
        WHERE cr.ticket_id = @ticketId
        ORDER BY cr.created_at DESC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching close request history:', error);
      throw error;
    }
  }
}

module.exports = TicketModel;
