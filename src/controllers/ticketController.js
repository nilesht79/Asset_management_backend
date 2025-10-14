/**
 * TICKET CONTROLLER
 * Handles HTTP requests for ticket management
 */

const TicketModel = require('../models/ticket');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');

class TicketController {
  /**
   * Create new ticket (Coordinator creates on behalf of employee)
   * POST /api/tickets
   */
  static async createTicket(req, res) {
    try {
      const {
        created_by_user_id,
        title,
        description,
        priority,
        category,
        assigned_to_engineer_id,
        due_date
      } = req.body;

      // Validation
      if (!created_by_user_id || !title) {
        return sendError(res, 'Employee and title are required', 400);
      }

      // Get coordinator ID from authenticated user
      const created_by_coordinator_id = req.oauth.user.id;

      // Prepare ticket data
      const ticketData = {
        created_by_user_id,
        created_by_coordinator_id,
        title,
        description,
        priority: priority || 'medium',
        category,
        assigned_to_engineer_id,
        due_date
      };

      // If engineer is assigned, set status to 'assigned'
      if (assigned_to_engineer_id) {
        ticketData.status = 'assigned';
      }

      // Create ticket (dept/location inherited automatically)
      const ticket = await TicketModel.createTicket(ticketData);

      // Fetch full ticket details with user info
      const fullTicket = await TicketModel.getTicketById(ticket.ticket_id);

      return sendCreated(res, fullTicket, 'Ticket created successfully');
    } catch (error) {
      console.error('Create ticket error:', error);
      return sendError(res, error.message || 'Failed to create ticket', 500);
    }
  }

  /**
   * Get all tickets with filters and pagination
   * GET /api/tickets
   */
  static async getTickets(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        priority,
        category,
        department_id,
        location_id,
        assigned_to_engineer_id,
        created_by_user_id,
        search
      } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (category) filters.category = category;
      if (department_id) filters.department_id = department_id;
      if (location_id) filters.location_id = location_id;
      if (assigned_to_engineer_id) filters.assigned_to_engineer_id = assigned_to_engineer_id;
      if (created_by_user_id) filters.created_by_user_id = created_by_user_id;
      if (search) filters.search = search;

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const result = await TicketModel.getTickets(filters, pagination);

      return sendSuccess(res, result, 'Tickets fetched successfully');
    } catch (error) {
      console.error('Get tickets error:', error);
      return sendError(res, error.message || 'Failed to fetch tickets', 500);
    }
  }

  /**
   * Get single ticket by ID
   * GET /api/tickets/:id
   */
  static async getTicketById(req, res) {
    try {
      const { id } = req.params;

      const ticket = await TicketModel.getTicketById(id);

      if (!ticket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // Get comments
      const comments = await TicketModel.getComments(id);

      return sendSuccess(res, { ticket, comments }, 'Ticket fetched successfully');
    } catch (error) {
      console.error('Get ticket error:', error);
      return sendError(res, error.message || 'Failed to fetch ticket', 500);
    }
  }

  /**
   * Update ticket
   * PUT /api/tickets/:id
   */
  static async updateTicket(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // Update ticket
      const updatedTicket = await TicketModel.updateTicket(id, updateData);

      // Fetch full details
      const fullTicket = await TicketModel.getTicketById(id);

      return sendSuccess(res, fullTicket, 'Ticket updated successfully');
    } catch (error) {
      console.error('Update ticket error:', error);
      return sendError(res, error.message || 'Failed to update ticket', 500);
    }
  }

  /**
   * Assign engineer to ticket
   * PUT /api/tickets/:id/assign
   */
  static async assignEngineer(req, res) {
    try {
      const { id } = req.params;
      const { engineer_id } = req.body;

      if (!engineer_id) {
        return sendError(res, 'Engineer ID is required', 400);
      }

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // Assign engineer
      await TicketModel.assignEngineer(id, engineer_id);

      // Fetch updated ticket
      const updatedTicket = await TicketModel.getTicketById(id);

      return sendSuccess(res, updatedTicket, 'Engineer assigned successfully');
    } catch (error) {
      console.error('Assign engineer error:', error);
      return sendError(res, error.message || 'Failed to assign engineer', 500);
    }
  }

  /**
   * Close ticket
   * PUT /api/tickets/:id/close
   */
  static async closeTicket(req, res) {
    try {
      const { id } = req.params;
      const { resolution_notes } = req.body;

      if (!resolution_notes) {
        return sendError(res, 'Resolution notes are required', 400);
      }

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // Close ticket
      await TicketModel.closeTicket(id, resolution_notes);

      // Fetch updated ticket
      const updatedTicket = await TicketModel.getTicketById(id);

      return sendSuccess(res, updatedTicket, 'Ticket closed successfully');
    } catch (error) {
      console.error('Close ticket error:', error);
      return sendError(res, error.message || 'Failed to close ticket', 500);
    }
  }

  /**
   * Get available engineers (optionally filtered by dept/location)
   * GET /api/tickets/engineers
   */
  static async getAvailableEngineers(req, res) {
    try {
      const { department_id, location_id } = req.query;

      const filters = {};
      if (department_id) filters.department_id = department_id;
      if (location_id) filters.location_id = location_id;

      const engineers = await TicketModel.getAvailableEngineers(filters);

      return sendSuccess(res, { engineers }, 'Engineers fetched successfully');
    } catch (error) {
      console.error('Get engineers error:', error);
      return sendError(res, error.message || 'Failed to fetch engineers', 500);
    }
  }

  /**
   * Get ticket statistics for dashboard
   * GET /api/tickets/stats
   */
  static async getTicketStats(req, res) {
    try {
      const { department_id, location_id } = req.query;

      const filters = {};
      if (department_id) filters.department_id = department_id;
      if (location_id) filters.location_id = location_id;

      const stats = await TicketModel.getTicketStats(filters);

      return sendSuccess(res, stats, 'Statistics fetched successfully');
    } catch (error) {
      console.error('Get stats error:', error);
      return sendError(res, error.message || 'Failed to fetch statistics', 500);
    }
  }

  /**
   * Add comment to ticket
   * POST /api/tickets/:id/comments
   */
  static async addComment(req, res) {
    try {
      const { id } = req.params;
      const { comment_text, is_internal } = req.body;

      if (!comment_text) {
        return sendError(res, 'Comment text is required', 400);
      }

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      const commentData = {
        ticket_id: id,
        user_id: req.oauth.user.id,
        comment_text,
        is_internal: is_internal || false
      };

      const comment = await TicketModel.addComment(commentData);

      return sendCreated(res, comment, 'Comment added successfully');
    } catch (error) {
      console.error('Add comment error:', error);
      return sendError(res, error.message || 'Failed to add comment', 500);
    }
  }

  /**
   * Get comments for a ticket
   * GET /api/tickets/:id/comments
   */
  static async getComments(req, res) {
    try {
      const { id } = req.params;

      const comments = await TicketModel.getComments(id);

      return sendSuccess(res, { comments }, 'Comments fetched successfully');
    } catch (error) {
      console.error('Get comments error:', error);
      return sendError(res, error.message || 'Failed to fetch comments', 500);
    }
  }

  /**
   * Get employees for ticket creation
   * GET /api/tickets/employees
   */
  static async getEmployees(req, res) {
    try {
      const { connectDB, sql } = require('../config/database');
      const pool = await connectDB();

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
        WHERE u.role IN ('employee', 'department_head', 'coordinator', 'department_coordinator')
          AND u.is_active = 1
        ORDER BY u.first_name, u.last_name
      `;

      const result = await pool.request().query(query);

      return sendSuccess(res, { employees: result.recordset }, 'Employees fetched successfully');
    } catch (error) {
      console.error('Get employees error:', error);
      return sendError(res, error.message || 'Failed to fetch employees', 500);
    }
  }
}

module.exports = TicketController;
