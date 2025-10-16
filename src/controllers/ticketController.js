/**
 * TICKET CONTROLLER
 * Handles HTTP requests for ticket management
 */

const TicketModel = require('../models/ticket');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');
const ExcelJS = require('exceljs');

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

  /**
   * Export tickets to Excel
   * GET /api/tickets/export
   */
  static async exportTickets(req, res) {
    try {
      const filters = req.query;

      // Get tickets using the same filtering logic (without pagination to get all)
      const result = await TicketModel.getTickets(filters, { page: 1, limit: 10000 });
      const tickets = result.tickets || [];

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Tickets');

      // Define columns
      worksheet.columns = [
        { header: 'Ticket #', key: 'ticket_number', width: 15 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Created For', key: 'created_by_user_name', width: 25 },
        { header: 'Created For Email', key: 'created_by_user_email', width: 30 },
        { header: 'Assigned To', key: 'engineer_name', width: 25 },
        { header: 'Engineer Email', key: 'engineer_email', width: 30 },
        { header: 'Department', key: 'department_name', width: 20 },
        { header: 'Location', key: 'location_name', width: 20 },
        { header: 'Created At', key: 'created_at', width: 20 },
        { header: 'Updated At', key: 'updated_at', width: 20 },
        { header: 'Resolved At', key: 'resolved_at', width: 20 },
        { header: 'Closed At', key: 'closed_at', width: 20 },
        { header: 'Due Date', key: 'due_date', width: 20 },
        { header: 'Resolution Notes', key: 'resolution_notes', width: 40 }
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      // Add data
      tickets.forEach(ticket => {
        worksheet.addRow({
          ticket_number: ticket.ticket_number,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          created_by_user_name: ticket.created_by_user_name,
          created_by_user_email: ticket.created_by_user_email,
          engineer_name: ticket.engineer_name || 'Unassigned',
          engineer_email: ticket.engineer_email || '',
          department_name: ticket.department_name || '',
          location_name: ticket.location_name || '',
          created_at: ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '',
          updated_at: ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : '',
          resolved_at: ticket.resolved_at ? new Date(ticket.resolved_at).toLocaleString() : '',
          closed_at: ticket.closed_at ? new Date(ticket.closed_at).toLocaleString() : '',
          due_date: ticket.due_date ? new Date(ticket.due_date).toLocaleString() : '',
          resolution_notes: ticket.resolution_notes || ''
        });
      });

      // Set response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=tickets_export_${new Date().toISOString().split('T')[0]}.xlsx`
      );

      // Write to response
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Export tickets error:', error);
      return sendError(res, error.message || 'Failed to export tickets', 500);
    }
  }
}

module.exports = TicketController;
