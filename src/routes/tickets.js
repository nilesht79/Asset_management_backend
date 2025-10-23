/**
 * TICKET ROUTES
 * API endpoints for ticket management system
 */

const express = require('express');
const router = express.Router();
const TicketController = require('../controllers/ticketController');
const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRole } = require('../middleware/permissions');

// Roles that can manage tickets
const TICKET_MANAGERS = ['it_head', 'coordinator', 'superadmin', 'department_coordinator'];

/**
 * @route   GET /api/tickets/stats
 * @desc    Get ticket statistics for dashboard
 * @access  Coordinator, Superadmin
 */
router.get(
  '/stats',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getTicketStats
);

/**
 * @route   GET /api/tickets/engineers
 * @desc    Get available engineers for assignment
 * @access  Coordinator, Superadmin
 */
router.get(
  '/engineers',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getAvailableEngineers
);

/**
 * @route   GET /api/tickets/employees
 * @desc    Get employees for ticket creation
 * @access  Coordinator, Superadmin
 */
router.get(
  '/employees',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getEmployees
);

/**
 * @route   GET /api/tickets/export
 * @desc    Export tickets to Excel
 * @access  Coordinator, Superadmin
 */
router.get(
  '/export',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.exportTickets
);

/**
 * @route   GET /api/tickets/:id/comments
 * @desc    Get comments for a ticket
 * @access  Coordinator, Superadmin, Engineer
 */
router.get(
  '/:id/comments',
  authenticateOAuth,
  requireRole([...TICKET_MANAGERS, 'engineer']),
  TicketController.getComments
);

/**
 * @route   GET /api/tickets/:id
 * @desc    Get single ticket by ID
 * @access  Coordinator, Superadmin, Engineer
 */
router.get(
  '/:id',
  authenticateOAuth,
  requireRole([...TICKET_MANAGERS, 'engineer']),
  TicketController.getTicketById
);

/**
 * @route   GET /api/tickets
 * @desc    Get all tickets with filters and pagination
 * @access  Coordinator, Superadmin
 */
router.get(
  '/',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getTickets
);

/**
 * @route   POST /api/tickets
 * @desc    Create new ticket (on behalf of employee)
 * @access  Coordinator, Superadmin
 */
router.post(
  '/',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.createTicket
);

/**
 * @route   POST /api/tickets/:id/comments
 * @desc    Add comment to ticket
 * @access  Coordinator, Superadmin, Engineer
 */
router.post(
  '/:id/comments',
  authenticateOAuth,
  requireRole([...TICKET_MANAGERS, 'engineer']),
  TicketController.addComment
);

/**
 * @route   PUT /api/tickets/:id/assign
 * @desc    Assign engineer to ticket
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id/assign',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.assignEngineer
);

/**
 * @route   PUT /api/tickets/:id/close
 * @desc    Close ticket
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id/close',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.closeTicket
);

/**
 * @route   PUT /api/tickets/:id
 * @desc    Update ticket
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.updateTicket
);

module.exports = router;
