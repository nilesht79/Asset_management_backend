/**
 * TICKET CONTROLLER
 * Handles HTTP requests for ticket management
 */

const TicketModel = require('../models/ticket');
const TicketAssetsModel = require('../models/ticketAssets');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');
const ExcelJS = require('exceljs');
const SlaTrackingModel = require('../models/slaTracking');
const inAppNotificationService = require('../services/inAppNotificationService');
const NotificationModel = require('../models/notification');
const emailService = require('../services/emailService');
const { connectDB, sql } = require('../config/database');

class TicketController {
  /**
   * Create new ticket (Coordinator creates on behalf of employee, employee creates own, or for guest)
   * POST /api/tickets
   */
  static async createTicket(req, res) {
    try {
      const {
        is_guest,
        guest_name,
        guest_email,
        guest_phone,
        created_by_user_id,
        title,
        description,
        priority,
        category,
        ticket_type,
        service_type,
        assigned_to_engineer_id,
        due_date,
        asset_ids, // Optional array of asset IDs to link to ticket (for Hardware category)
        software_installation_ids // Optional array of software installation IDs (for Software category)
      } = req.body;

      // Get creator ID from authenticated user
      const authUserId = req.user?.id || req.oauth?.user?.id;
      const authUserRole = req.user?.role || req.oauth?.user?.role;

      // For employees, they create tickets for themselves
      // For coordinators/admins, they can create on behalf of someone else
      let ticketCreatorId = created_by_user_id;
      let coordinatorId = null;

      // Employee-like roles that create tickets for themselves (self-service)
      const selfServiceRoles = ['employee', 'dept_head', 'it_head'];

      if (selfServiceRoles.includes(authUserRole)) {
        // Self-service: employees create tickets for themselves
        ticketCreatorId = authUserId;
        coordinatorId = null; // No coordinator for self-service
      } else {
        // Coordinators/Admins/Engineers create on behalf of employees
        coordinatorId = authUserId;
      }

      // Validation based on ticket type
      if (is_guest) {
        // Guest ticket validation
        if (!guest_name || !guest_email) {
          return sendError(res, 'Guest name and email are required for guest tickets', 400);
        }
        if (!title) {
          return sendError(res, 'Title is required', 400);
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(guest_email)) {
          return sendError(res, 'Invalid email format', 400);
        }
      } else {
        // Employee ticket validation
        if (!ticketCreatorId || !title) {
          return sendError(res, 'Title is required', 400);
        }
      }

      // Prepare ticket data
      // For employees (self-service), enforce ticket_type and service_type
      let finalTicketType = ticket_type || 'internal';
      let finalServiceType = service_type || 'general';

      if (selfServiceRoles.includes(authUserRole)) {
        // Employees can only create Service Request tickets with General Support
        finalTicketType = 'service_request';
        finalServiceType = 'general';
      }

      const ticketData = {
        created_by_user_id: is_guest ? null : ticketCreatorId,
        created_by_coordinator_id: coordinatorId,
        title,
        description,
        priority: priority || 'medium',
        category,
        ticket_type: finalTicketType,
        service_type: finalServiceType,
        assigned_to_engineer_id,
        due_date
      };

      // If engineer is assigned, set status to 'in_progress'
      if (assigned_to_engineer_id) {
        ticketData.status = 'in_progress';
      }

      let ticket;

      if (is_guest) {
        // Create guest ticket
        const guestData = {
          guest_name,
          guest_email,
          guest_phone: guest_phone || null
        };
        ticket = await TicketModel.createGuestTicket(ticketData, guestData);
      } else {
        // Create regular employee ticket (dept/location inherited automatically)
        ticket = await TicketModel.createTicket(ticketData);
      }

      // Fetch full ticket details with user/guest info
      const fullTicket = await TicketModel.getTicketById(ticket.ticket_id);

      // Link assets to ticket if provided (BEFORE SLA initialization)
      let linkedAssetIds = [];

      // For Hardware category: use asset_ids directly
      if (asset_ids && Array.isArray(asset_ids) && asset_ids.length > 0) {
        try {
          await TicketAssetsModel.linkMultipleAssets(
            ticket.ticket_id,
            asset_ids,
            authUserId
          );
          linkedAssetIds = asset_ids;
          console.log(`Linked ${asset_ids.length} assets to ticket ${ticket.ticket_number}`);
        } catch (assetError) {
          console.error('Failed to link assets during ticket creation:', assetError.message);
          // Continue with ticket creation even if asset linking fails
        }
      }

      // For Software category: extract asset_ids from software_installation_ids and link those
      if (software_installation_ids && Array.isArray(software_installation_ids) && software_installation_ids.length > 0) {
        try {
          // Get asset IDs from software installations
          const pool = await connectDB();
          const placeholders = software_installation_ids.map((_, i) => `@id${i}`).join(', ');
          const request = pool.request();
          software_installation_ids.forEach((id, i) => {
            request.input(`id${i}`, sql.UniqueIdentifier, id);
          });

          const result = await request.query(`
            SELECT DISTINCT asset_id FROM asset_software_installations
            WHERE id IN (${placeholders})
          `);

          const softwareAssetIds = result.recordset.map(r => r.asset_id);

          if (softwareAssetIds.length > 0) {
            // Filter out any already linked assets
            const newAssetIds = softwareAssetIds.filter(id => !linkedAssetIds.includes(id));

            if (newAssetIds.length > 0) {
              await TicketAssetsModel.linkMultipleAssets(
                ticket.ticket_id,
                newAssetIds,
                authUserId
              );
              linkedAssetIds = [...linkedAssetIds, ...newAssetIds];
              console.log(`Linked ${newAssetIds.length} assets from software installations to ticket ${ticket.ticket_number}`);
            }
          }

          // Also link the software installations directly to the ticket
          await TicketAssetsModel.linkMultipleSoftware(
            ticket.ticket_id,
            software_installation_ids,
            authUserId
          );
          console.log(`Linked ${software_installation_ids.length} software installations to ticket ${ticket.ticket_number}`);
        } catch (softwareError) {
          console.error('Failed to link software assets during ticket creation:', softwareError.message);
          // Continue with ticket creation even if software asset linking fails
        }
      }

      // Initialize SLA tracking ONLY if assets are linked to the ticket
      if (linkedAssetIds.length > 0) {
        try {
          const ticketContext = {
            ticket_id: ticket.ticket_id,
            ticket_type: fullTicket.ticket_type || 'internal',
            service_type: fullTicket.service_type || 'general',
            ticket_channel: 'portal', // Default channel
            priority: fullTicket.priority || 'medium',
            user_id: fullTicket.created_by_user_id,
            asset_ids: linkedAssetIds
          };

          await SlaTrackingModel.initializeTracking(ticket.ticket_id, ticketContext);
          console.log(`SLA tracking initialized for ticket ${ticket.ticket_number}`);
        } catch (slaError) {
          // Log but don't fail the ticket creation if SLA init fails
          console.error('Failed to initialize SLA tracking:', slaError.message);
        }
      } else {
        console.log(`SLA tracking skipped for ticket ${ticket.ticket_number} - no assets linked`);
      }

      // Create notification for assigned engineer
      if (assigned_to_engineer_id) {
        try {
          await inAppNotificationService.createTicketAssignmentNotification({
            engineer_id: assigned_to_engineer_id,
            ticket_id: ticket.ticket_id,
            ticket_number: ticket.ticket_number,
            ticket_title: title,
            assigned_by_name: req.oauth.user.name || req.oauth.user.email || 'Coordinator'
          });

          // Send email notification
          const engineerEmail = await TicketController.getEngineerEmail(assigned_to_engineer_id);
          if (engineerEmail) {
            const assignedByName = req.oauth.user.name || req.oauth.user.email || 'Coordinator';
            const emailSubject = `New Ticket Assigned: ${ticket.ticket_number}`;
            const emailBody = `
Hello,

A new ticket has been assigned to you.

Ticket Number: ${ticket.ticket_number}
Title: ${title}
Priority: ${fullTicket.priority || 'medium'}
Status: ${fullTicket.status}
Assigned By: ${assignedByName}

Description:
${description || 'No description provided'}

Please log in to the Unified ITSM Platform to view and work on this ticket.

This is an automated notification. Please do not reply to this email.
            `;

            await emailService.sendEmail(engineerEmail, emailSubject, emailBody.trim());
            console.log(`Assignment email sent to ${engineerEmail} for ticket ${ticket.ticket_number}`);
          }
        } catch (notificationError) {
          // Log but don't fail ticket creation if notification fails
          console.error('Failed to create assignment notification:', notificationError.message);
        }
      }

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
        search,
        is_guest
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
      if (is_guest !== undefined) filters.is_guest = parseInt(is_guest);

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
      const userId = req.user.id;
      const userRole = req.user.role;

      const ticket = await TicketModel.getTicketById(id);

      if (!ticket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // If user is an employee, they can only view their own tickets
      if (userRole === 'employee' && ticket.created_by_user_id !== userId) {
        return sendError(res, 'Access denied. You can only view your own tickets.', 403);
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
      const { asset_ids, software_installation_ids, ...updateData } = req.body;
      const authUserId = req.oauth?.user?.id || req.user?.id;

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // Prevent editing closed tickets (must reopen first)
      if (existingTicket.status === 'closed' || existingTicket.status === 'cancelled') {
        return sendError(res, 'Cannot edit a closed or cancelled ticket. Please reopen the ticket first.', 400);
      }

      const previousStatus = existingTicket.status;
      const previousPriority = existingTicket.priority;
      const previousEngineerId = existingTicket.assigned_to_engineer_id;
      const previousCategory = existingTicket.category;
      const previousTicketType = existingTicket.ticket_type;

      // Update ticket
      const updatedTicket = await TicketModel.updateTicket(id, updateData);

      // Handle category change - clear opposite type's links
      const newCategory = updateData.category || previousCategory;
      if (updateData.category && updateData.category !== previousCategory) {
        try {
          // If category changed FROM Hardware to something else, clear assets
          if (previousCategory === 'Hardware' && newCategory !== 'Hardware') {
            await TicketAssetsModel.clearTicketAssets(id);
            console.log(`Cleared assets from ticket ${existingTicket.ticket_number} due to category change`);
          }
          // If category changed FROM Software to something else, clear software
          if (previousCategory === 'Software' && newCategory !== 'Software') {
            await TicketAssetsModel.clearTicketSoftware(id);
            console.log(`Cleared software from ticket ${existingTicket.ticket_number} due to category change`);
          }
        } catch (clearError) {
          console.error('Error clearing assets/software on category change:', clearError.message);
        }
      }

      // Track if assets changed for SLA recalculation
      let assetsChanged = false;
      let previousAssetIds = [];

      // Get previous asset IDs before sync for comparison
      try {
        previousAssetIds = await TicketAssetsModel.getTicketAssetIds(id);
      } catch (err) {
        console.error('Error getting previous asset IDs:', err.message);
      }

      // Sync assets if provided and category is Hardware
      if (asset_ids !== undefined && newCategory === 'Hardware') {
        try {
          const syncResult = await TicketAssetsModel.syncTicketAssets(id, asset_ids, authUserId);
          console.log(`Synced assets for ticket ${existingTicket.ticket_number}: added ${syncResult.added}, removed ${syncResult.removed}`);

          // Check if assets actually changed
          if (syncResult.added > 0 || syncResult.removed > 0) {
            assetsChanged = true;
          }
        } catch (syncError) {
          console.error('Error syncing ticket assets:', syncError.message);
        }
      }

      // Sync software if provided and category is Software
      if (software_installation_ids !== undefined && newCategory === 'Software') {
        try {
          const syncResult = await TicketAssetsModel.syncTicketSoftware(id, software_installation_ids, authUserId);
          console.log(`Synced software for ticket ${existingTicket.ticket_number}: added ${syncResult.added}, removed ${syncResult.removed}`);

          // Also sync the underlying assets from software installations
          if (software_installation_ids.length > 0) {
            const pool = await connectDB();
            const placeholders = software_installation_ids.map((_, i) => `@id${i}`).join(', ');
            const request = pool.request();
            software_installation_ids.forEach((sid, i) => {
              request.input(`id${i}`, sql.UniqueIdentifier, sid);
            });
            const result = await request.query(`
              SELECT DISTINCT asset_id FROM asset_software_installations
              WHERE id IN (${placeholders})
            `);
            const softwareAssetIds = result.recordset.map(r => r.asset_id);
            if (softwareAssetIds.length > 0) {
              const assetSyncResult = await TicketAssetsModel.syncTicketAssets(id, softwareAssetIds, authUserId);
              if (assetSyncResult.added > 0 || assetSyncResult.removed > 0) {
                assetsChanged = true;
              }
            }
          } else {
            // Clear assets if no software selected
            await TicketAssetsModel.clearTicketAssets(id);
            if (previousAssetIds.length > 0) {
              assetsChanged = true;
            }
          }
        } catch (syncError) {
          console.error('Error syncing ticket software:', syncError.message);
        }
      }

      // Check if category change cleared assets
      if (updateData.category && updateData.category !== previousCategory) {
        if ((previousCategory === 'Hardware' || previousCategory === 'Software') &&
            previousAssetIds.length > 0) {
          assetsChanged = true;
        }
      }

      // Fetch full details
      const fullTicket = await TicketModel.getTicketById(id);

      // Handle SLA pause/resume on status change
      const pauseStatuses = ['pending_closure', 'awaiting_info', 'on_hold'];
      const newStatus = updateData.status || previousStatus;

      if (updateData.status && updateData.status !== previousStatus) {
        try {
          const wasInPauseStatus = pauseStatuses.includes(previousStatus);
          const nowInPauseStatus = pauseStatuses.includes(newStatus);

          if (!wasInPauseStatus && nowInPauseStatus) {
            // Status changed to a pause status - pause SLA
            await SlaTrackingModel.pauseTimer(
              id,
              `Status changed to ${newStatus}`,
              req.oauth.user.id
            );
            console.log(`SLA paused for ticket ${fullTicket.ticket_number} - status: ${newStatus}`);
          } else if (wasInPauseStatus && !nowInPauseStatus) {
            // Status changed from a pause status - resume SLA
            await SlaTrackingModel.resumeTimer(id, req.oauth.user.id);
            console.log(`SLA resumed for ticket ${fullTicket.ticket_number} - status: ${newStatus}`);
          }
        } catch (slaError) {
          console.error('Failed to update SLA on status change:', slaError.message);
        }
      }

      // Handle SLA recalculation when priority, assets, or ticket_type change
      // SLA matching considers: priority, asset importance, VIP status, ticket type
      const priorityChanged = updateData.priority && updateData.priority !== previousPriority;
      const ticketTypeChanged = updateData.ticket_type && updateData.ticket_type !== previousTicketType;

      if (priorityChanged || assetsChanged || ticketTypeChanged) {
        try {
          // Build ticket context for SLA matching with current state
          const ticketAssetIds = await TicketAssetsModel.getTicketAssetIds(id);
          const newTicketContext = {
            ticket_id: id,
            ticket_type: fullTicket.ticket_type,
            ticket_channel: fullTicket.ticket_channel || 'web',
            priority: fullTicket.priority, // Use current priority from fullTicket
            user_id: fullTicket.created_by_user_id,
            asset_ids: ticketAssetIds
          };

          const slaResult = await SlaTrackingModel.recalculateSlaOnPriorityChange(
            id,
            newTicketContext,
            authUserId
          );

          if (slaResult && slaResult.sla_recalculated) {
            const changeReason = [];
            if (priorityChanged) changeReason.push(`priority: ${previousPriority} → ${updateData.priority}`);
            if (ticketTypeChanged) changeReason.push(`ticket_type: ${previousTicketType} → ${updateData.ticket_type}`);
            if (assetsChanged) changeReason.push('assets modified');
            console.log(`SLA recalculated for ticket ${fullTicket.ticket_number} due to: ${changeReason.join(', ')}`);
          }
        } catch (slaError) {
          console.error('Failed to recalculate SLA:', slaError.message);
        }
      }

      // Create notification if engineer was assigned or reassigned
      if (updateData.assigned_to_engineer_id && updateData.assigned_to_engineer_id !== previousEngineerId) {
        try {
          await inAppNotificationService.createTicketAssignmentNotification({
            engineer_id: updateData.assigned_to_engineer_id,
            ticket_id: id,
            ticket_number: fullTicket.ticket_number,
            ticket_title: fullTicket.title,
            assigned_by_name: req.oauth.user.name || req.oauth.user.email || 'Coordinator'
          });

          // Send email notification
          const engineerEmail = await TicketController.getEngineerEmail(updateData.assigned_to_engineer_id);
          if (engineerEmail) {
            const assignedByName = req.oauth.user.name || req.oauth.user.email || 'Coordinator';
            const isReassignment = previousEngineerId !== null;
            const emailSubject = `Ticket ${isReassignment ? 'Reassigned' : 'Assigned'}: ${fullTicket.ticket_number}`;
            const emailBody = `
Hello,

A ticket has been ${isReassignment ? 'reassigned' : 'assigned'} to you.

Ticket Number: ${fullTicket.ticket_number}
Title: ${fullTicket.title}
Priority: ${fullTicket.priority || 'medium'}
Status: ${fullTicket.status}
${isReassignment ? 'Reassigned' : 'Assigned'} By: ${assignedByName}

Description:
${fullTicket.description || 'No description provided'}

Please log in to the Unified ITSM Platform to view and work on this ticket.

This is an automated notification. Please do not reply to this email.
            `;

            await emailService.sendEmail(engineerEmail, emailSubject, emailBody.trim());
            console.log(`${isReassignment ? 'Reassignment' : 'Assignment'} email sent to ${engineerEmail} for ticket ${fullTicket.ticket_number}`);
          }
        } catch (notificationError) {
          // Log but don't fail update if notification fails
          console.error('Failed to create assignment notification:', notificationError.message);
        }
      }

      // Create notification if ticket was reopened
      const closedStatuses = ['closed', 'resolved'];
      const activeStatuses = ['open', 'assigned', 'in_progress', 'pending'];
      const wasReopened = closedStatuses.includes(previousStatus) &&
                         activeStatuses.includes(newStatus) &&
                         fullTicket.assigned_to_engineer_id;

      if (wasReopened) {
        try {
          await NotificationModel.createNotification({
            user_id: fullTicket.assigned_to_engineer_id,
            ticket_id: id,
            notification_type: 'ticket_reopened',
            title: `Ticket Reopened: ${fullTicket.ticket_number}`,
            message: `Ticket "${fullTicket.title}" has been reopened and requires your attention.`,
            priority: 'high',
            related_data: {
              ticket_number: fullTicket.ticket_number,
              ticket_title: fullTicket.title,
              previous_status: previousStatus,
              new_status: newStatus,
              reopened_by: req.oauth.user.name || req.oauth.user.email || 'System'
            }
          });
          console.log(`Created reopen notification for ticket ${fullTicket.ticket_number}`);

          // Send email notification
          const engineerEmail = await TicketController.getEngineerEmail(fullTicket.assigned_to_engineer_id);
          if (engineerEmail) {
            const reopenedByName = req.oauth.user.name || req.oauth.user.email || 'System';
            const emailSubject = `Ticket Reopened: ${fullTicket.ticket_number}`;
            const emailBody = `
Hello,

A previously ${previousStatus} ticket has been reopened and requires your attention.

Ticket Number: ${fullTicket.ticket_number}
Title: ${fullTicket.title}
Priority: ${fullTicket.priority || 'medium'}
Previous Status: ${previousStatus}
Current Status: ${newStatus}
Reopened By: ${reopenedByName}

Description:
${fullTicket.description || 'No description provided'}

This ticket has been reactivated and the SLA tracking has been resumed. Please review and take necessary action.

Please log in to the Unified ITSM Platform to view and work on this ticket.

This is an automated notification. Please do not reply to this email.
            `;

            await emailService.sendEmail(engineerEmail, emailSubject, emailBody.trim());
            console.log(`Reopen email sent to ${engineerEmail} for ticket ${fullTicket.ticket_number}`);
          }
        } catch (notificationError) {
          // Log but don't fail update if notification fails
          console.error('Failed to create reopen notification:', notificationError.message);
        }
      }

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

      // Create notification for assigned engineer
      try {
        await inAppNotificationService.createTicketAssignmentNotification({
          engineer_id: engineer_id,
          ticket_id: id,
          ticket_number: updatedTicket.ticket_number,
          ticket_title: updatedTicket.title,
          assigned_by_name: req.oauth.user.name || req.oauth.user.email || 'Coordinator'
        });

        // Send email notification
        const engineerEmail = await TicketController.getEngineerEmail(engineer_id);
        if (engineerEmail) {
          const assignedByName = req.oauth.user.name || req.oauth.user.email || 'Coordinator';
          const emailSubject = `Ticket Assigned: ${updatedTicket.ticket_number}`;
          const emailBody = `
Hello,

A ticket has been assigned to you.

Ticket Number: ${updatedTicket.ticket_number}
Title: ${updatedTicket.title}
Priority: ${updatedTicket.priority || 'medium'}
Status: ${updatedTicket.status}
Assigned By: ${assignedByName}

Description:
${updatedTicket.description || 'No description provided'}

Please log in to the Unified ITSM Platform to view and work on this ticket.

This is an automated notification. Please do not reply to this email.
          `;

          await emailService.sendEmail(engineerEmail, emailSubject, emailBody.trim());
          console.log(`Assignment email sent to ${engineerEmail} for ticket ${updatedTicket.ticket_number}`);
        }
      } catch (notificationError) {
        // Log but don't fail assignment if notification fails
        console.error('Failed to create assignment notification:', notificationError.message);
      }

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

      // Stop SLA tracking
      try {
        const slaResult = await SlaTrackingModel.stopTracking(id, null);
        if (slaResult) {
          console.log(`SLA tracking stopped for ticket ${existingTicket.ticket_number} - final status: ${slaResult.final_status}`);
        }
      } catch (slaError) {
        console.error('Failed to stop SLA tracking:', slaError.message);
      }

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
      const userId = req.user?.id || req.oauth?.user?.id;
      const userRole = req.user?.role || req.oauth?.user?.role;

      if (!comment_text) {
        return sendError(res, 'Comment text is required', 400);
      }

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // If user is an employee, verify they own the ticket
      if (userRole === 'employee' && existingTicket.created_by_user_id !== userId) {
        return sendError(res, 'Access denied. You can only comment on your own tickets.', 403);
      }

      const commentData = {
        ticket_id: id,
        user_id: userId,
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
      const userId = req.user.id;
      const userRole = req.user.role;

      // If user is an employee, verify they own the ticket
      if (userRole === 'employee') {
        const ticket = await TicketModel.getTicketById(id);
        if (!ticket || ticket.created_by_user_id !== userId) {
          return sendError(res, 'Access denied. You can only view your own tickets.', 403);
        }
      }

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

  /**
   * Get filter options - returns only values that exist in database
   * GET /api/tickets/filter-options
   */
  static async getFilterOptions(req, res) {
    try {
      const filterOptions = await TicketModel.getFilterOptions();

      return sendSuccess(res, filterOptions, 'Filter options fetched successfully');
    } catch (error) {
      console.error('Get filter options error:', error);
      return sendError(res, error.message || 'Failed to fetch filter options', 500);
    }
  }

  /**
   * Get tickets assigned to current engineer
   * GET /api/tickets/my-tickets
   */
  static async getMyTickets(req, res) {
    try {
      const engineerId = req.oauth.user.id;
      const {
        page = 1,
        limit = 10,
        status,
        priority,
        search
      } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (search) filters.search = search;

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const result = await TicketModel.getEngineerTickets(engineerId, filters, pagination);

      return sendSuccess(res, result, 'Tickets fetched successfully');
    } catch (error) {
      console.error('Get my tickets error:', error);
      return sendError(res, error.message || 'Failed to fetch tickets', 500);
    }
  }

  /**
   * Get tickets created by current user (employee view)
   * GET /api/tickets/my-created-tickets
   */
  static async getMyCreatedTickets(req, res) {
    try {
      const userId = req.oauth.user.id;
      const {
        page = 1,
        limit = 10,
        status,
        priority,
        search
      } = req.query;

      const pool = await connectDB();

      // Build WHERE clause
      let whereClause = 'WHERE t.created_by_user_id = @userId';
      if (status) whereClause += ' AND t.status = @status';
      if (priority) whereClause += ' AND t.priority = @priority';
      if (search) whereClause += ' AND (t.ticket_number LIKE @search OR t.title LIKE @search)';

      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Get tickets
      const request = pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, parseInt(limit));

      if (status) request.input('status', sql.VarChar, status);
      if (priority) request.input('priority', sql.VarChar, priority);
      if (search) request.input('search', sql.NVarChar, `%${search}%`);

      const ticketsResult = await request.query(`
        SELECT
          t.ticket_id,
          t.ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category,
          t.created_at,
          t.updated_at,
          t.resolved_at,
          t.closed_at,
          t.created_by_user_id,
          t.created_by_coordinator_id,
          -- Created By User (Employee)
          u.first_name + ' ' + u.last_name as created_by_user_name,
          u.email as created_by_user_email,
          -- Coordinator who created the ticket
          c.first_name + ' ' + c.last_name as coordinator_name,
          c.email as coordinator_email,
          -- Assigned Engineer
          e.first_name + ' ' + e.last_name as engineer_name,
          e.email as engineer_email,
          d.department_name as department_name,
          l.name as location_name
        FROM TICKETS t
        LEFT JOIN USER_MASTER u ON t.created_by_user_id = u.user_id
        LEFT JOIN USER_MASTER c ON t.created_by_coordinator_id = c.user_id
        LEFT JOIN USER_MASTER e ON t.assigned_to_engineer_id = e.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

      // Get total count
      const countRequest = pool.request()
        .input('userId', sql.UniqueIdentifier, userId);
      if (status) countRequest.input('status', sql.VarChar, status);
      if (priority) countRequest.input('priority', sql.VarChar, priority);
      if (search) countRequest.input('search', sql.NVarChar, `%${search}%`);

      const countResult = await countRequest.query(`
        SELECT COUNT(*) as total FROM TICKETS t ${whereClause}
      `);

      const total = countResult.recordset[0].total;

      return sendSuccess(res, {
        tickets: ticketsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }, 'Tickets fetched successfully');
    } catch (error) {
      console.error('Get my created tickets error:', error);
      return sendError(res, error.message || 'Failed to fetch tickets', 500);
    }
  }

  /**
   * Engineer requests to close a ticket
   * POST /api/tickets/:id/request-close
   */
  static async requestTicketClose(req, res) {
    try {
      const { id } = req.params;
      const { request_notes, service_report_id } = req.body;
      const engineerId = req.oauth.user.id;

      if (!request_notes) {
        return sendError(res, 'Resolution notes are required', 400);
      }

      // Check if ticket exists
      const existingTicket = await TicketModel.getTicketById(id);
      if (!existingTicket) {
        return sendNotFound(res, 'Ticket not found');
      }

      // Request close (with optional service_report_id for repair/replace tickets)
      await TicketModel.requestTicketClose(id, engineerId, request_notes, service_report_id || null);

      // Fetch updated ticket
      const updatedTicket = await TicketModel.getTicketById(id);

      return sendSuccess(res, updatedTicket, 'Close request submitted successfully');
    } catch (error) {
      console.error('Request ticket close error:', error);
      return sendError(res, error.message || 'Failed to submit close request', 500);
    }
  }

  /**
   * Get pending close requests for coordinator
   * GET /api/tickets/pending-close-requests
   */
  static async getPendingCloseRequests(req, res) {
    try {
      const { department_id, location_id } = req.query;

      const filters = {};
      if (department_id) filters.department_id = department_id;
      if (location_id) filters.location_id = location_id;

      const requests = await TicketModel.getPendingCloseRequests(filters);

      return sendSuccess(res, { requests }, 'Close requests fetched successfully');
    } catch (error) {
      console.error('Get pending close requests error:', error);
      return sendError(res, error.message || 'Failed to fetch close requests', 500);
    }
  }

  /**
   * Get close request count (for badge)
   * GET /api/tickets/close-requests-count
   */
  static async getCloseRequestCount(req, res) {
    try {
      const { department_id } = req.query;

      const filters = {};
      if (department_id) filters.department_id = department_id;

      const count = await TicketModel.getCloseRequestCount(filters);

      return sendSuccess(res, { count }, 'Count fetched successfully');
    } catch (error) {
      console.error('Get close request count error:', error);
      return sendError(res, error.message || 'Failed to fetch count', 500);
    }
  }

  /**
   * Coordinator approves or rejects close request
   * PUT /api/tickets/:id/review-close-request
   */
  static async reviewCloseRequest(req, res) {
    try {
      const { id } = req.params; // close_request_id
      const { action, review_notes } = req.body;
      const coordinatorId = req.oauth.user.id;

      if (!action || !['approved', 'rejected'].includes(action)) {
        return sendError(res, 'Valid action (approved/rejected) is required', 400);
      }

      // Review the close request
      const updatedTicket = await TicketModel.reviewCloseRequest(
        id,
        coordinatorId,
        action,
        review_notes
      );

      // Stop SLA tracking if approved
      if (action === 'approved' && updatedTicket) {
        try {
          const slaResult = await SlaTrackingModel.stopTracking(updatedTicket.ticket_id, null);
          if (slaResult) {
            console.log(`SLA tracking stopped for ticket ${updatedTicket.ticket_number} via close request approval`);
          }
        } catch (slaError) {
          console.error('Failed to stop SLA tracking on close request approval:', slaError.message);
        }
      }

      const message = action === 'approved'
        ? 'Ticket closed successfully'
        : 'Close request rejected';

      return sendSuccess(res, updatedTicket, message);
    } catch (error) {
      console.error('Review close request error:', error);
      return sendError(res, error.message || 'Failed to review close request', 500);
    }
  }

  /**
   * Get close request history for a ticket
   * GET /api/tickets/:id/close-request-history
   */
  static async getCloseRequestHistory(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // If user is an employee, verify they own the ticket
      if (userRole === 'employee') {
        const ticket = await TicketModel.getTicketById(id);
        if (!ticket || ticket.created_by_user_id !== userId) {
          return sendError(res, 'Access denied. You can only view your own tickets.', 403);
        }
      }

      const history = await TicketModel.getCloseRequestHistory(id);

      return sendSuccess(res, { history }, 'Close request history fetched successfully');
    } catch (error) {
      console.error('Get close request history error:', error);
      return sendError(res, error.message || 'Failed to fetch close request history', 500);
    }
  }

  /**
   * Get ticket trend analysis
   * GET /api/tickets/trend-analysis
   */
  static async getTrendAnalysis(req, res) {
    try {
      const {
        months_back,
        location_id,
        department_id,
        priority,
        engineer_id
      } = req.query;

      const filters = {};
      if (months_back) filters.months_back = parseInt(months_back);
      if (location_id) filters.location_id = location_id;
      if (department_id) filters.department_id = department_id;
      if (priority) filters.priority = priority;
      if (engineer_id) filters.engineer_id = engineer_id;

      const trendData = await TicketModel.getTicketTrendAnalysis(filters);

      return sendSuccess(res, trendData, 'Trend analysis fetched successfully');
    } catch (error) {
      console.error('Get trend analysis error:', error);
      return sendError(res, error.message || 'Failed to fetch trend analysis', 500);
    }
  }

  /**
   * Export ticket trend analysis to Excel
   * GET /api/tickets/trend-analysis/export
   */
  static async exportTrendAnalysis(req, res) {
    try {
      const {
        months_back,
        location_id,
        department_id,
        priority,
        engineer_id
      } = req.query;

      const filters = {};
      if (months_back) filters.months_back = parseInt(months_back);
      if (location_id) filters.location_id = location_id;
      if (department_id) filters.department_id = department_id;
      if (priority) filters.priority = priority;
      if (engineer_id) filters.engineer_id = engineer_id;

      const trendData = await TicketModel.getTicketTrendAnalysis(filters);

      // Create workbook
      const workbook = new ExcelJS.Workbook();

      // Sheet 1: Summary
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 }
      ];
      summarySheet.getRow(1).font = { bold: true };
      summarySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      const summary = trendData.summary || {};
      summarySheet.addRow({ metric: 'Total Tickets', value: summary.total_tickets || 0 });
      summarySheet.addRow({ metric: 'Closed Tickets', value: summary.closed_tickets || 0 });
      summarySheet.addRow({ metric: 'Active Tickets', value: summary.active_tickets || 0 });
      summarySheet.addRow({ metric: 'Critical Tickets', value: summary.critical_tickets || 0 });
      summarySheet.addRow({ metric: 'Avg Resolution Hours', value: summary.avg_resolution_hours ? Math.round(summary.avg_resolution_hours) : 'N/A' });
      summarySheet.addRow({ metric: 'Unique Categories', value: summary.unique_categories || 0 });
      summarySheet.addRow({ metric: 'Analysis Period (Months)', value: filters.months_back || 6 });

      // Sheet 2: Monthly Volume
      const monthlySheet = workbook.addWorksheet('Monthly Volume');
      monthlySheet.columns = [
        { header: 'Period', key: 'period_label', width: 20 },
        { header: 'Total Tickets', key: 'total_tickets', width: 15 },
        { header: 'Closed', key: 'closed_tickets', width: 12 },
        { header: 'Active', key: 'active_tickets', width: 12 },
        { header: 'Critical', key: 'critical_tickets', width: 12 },
        { header: 'Avg Resolution (hrs)', key: 'avg_resolution_hours', width: 20 },
        { header: 'Change', key: 'change', width: 12 },
        { header: 'Change %', key: 'change_percent', width: 12 }
      ];
      monthlySheet.getRow(1).font = { bold: true };
      monthlySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      monthlySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      (trendData.monthly_volume || []).forEach(row => {
        monthlySheet.addRow({
          ...row,
          avg_resolution_hours: row.avg_resolution_hours ? Math.round(row.avg_resolution_hours) : 'N/A',
          change: row.change !== null ? row.change : 'N/A',
          change_percent: row.change_percent !== null ? `${row.change_percent}%` : 'N/A'
        });
      });

      // Sheet 3: By Category
      const categorySheet = workbook.addWorksheet('By Category');
      categorySheet.columns = [
        { header: 'Category', key: 'category', width: 25 },
        { header: 'Total Tickets', key: 'total_tickets', width: 15 },
        { header: 'Closed', key: 'closed_tickets', width: 12 },
        { header: 'Active', key: 'active_tickets', width: 12 },
        { header: 'Percentage', key: 'percentage', width: 12 }
      ];
      categorySheet.getRow(1).font = { bold: true };
      categorySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      categorySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      (trendData.by_category || []).forEach(row => {
        categorySheet.addRow({
          ...row,
          percentage: `${row.percentage}%`
        });
      });

      // Sheet 4: By Priority
      const prioritySheet = workbook.addWorksheet('By Priority');
      prioritySheet.columns = [
        { header: 'Priority', key: 'priority', width: 15 },
        { header: 'Total Tickets', key: 'total_tickets', width: 15 },
        { header: 'Closed', key: 'closed_tickets', width: 12 },
        { header: 'Percentage', key: 'percentage', width: 12 }
      ];
      prioritySheet.getRow(1).font = { bold: true };
      prioritySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      prioritySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      (trendData.by_priority || []).forEach(row => {
        prioritySheet.addRow({
          ...row,
          percentage: `${row.percentage}%`
        });
      });

      // Sheet 5: By Location
      const locationSheet = workbook.addWorksheet('By Location');
      locationSheet.columns = [
        { header: 'Location', key: 'location_name', width: 25 },
        { header: 'Total Tickets', key: 'total_tickets', width: 15 },
        { header: 'Closed', key: 'closed_tickets', width: 12 },
        { header: 'Percentage', key: 'percentage', width: 12 }
      ];
      locationSheet.getRow(1).font = { bold: true };
      locationSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      locationSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      (trendData.by_location || []).forEach(row => {
        locationSheet.addRow({
          ...row,
          percentage: `${row.percentage}%`
        });
      });

      // Sheet 6: By Department
      const departmentSheet = workbook.addWorksheet('By Department');
      departmentSheet.columns = [
        { header: 'Department', key: 'department_name', width: 25 },
        { header: 'Total Tickets', key: 'total_tickets', width: 15 },
        { header: 'Closed', key: 'closed_tickets', width: 12 },
        { header: 'Percentage', key: 'percentage', width: 12 }
      ];
      departmentSheet.getRow(1).font = { bold: true };
      departmentSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      departmentSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      (trendData.by_department || []).forEach(row => {
        departmentSheet.addRow({
          ...row,
          percentage: `${row.percentage}%`
        });
      });

      // Set response headers
      const monthsLabel = filters.months_back || 6;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=ticket_trend_analysis_${monthsLabel}m_${new Date().toISOString().split('T')[0]}.xlsx`
      );

      // Write to response
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Export trend analysis error:', error);
      return sendError(res, error.message || 'Failed to export trend analysis', 500);
    }
  }

  /**
   * Get ticket reopen configuration
   * GET /api/tickets/reopen-config
   */
  static async getReopenConfig(req, res) {
    try {
      const config = await TicketModel.getReopenConfig();

      if (!config) {
        return sendNotFound(res, 'Reopen configuration not found');
      }

      return sendSuccess(res, config);
    } catch (error) {
      console.error('Get reopen config error:', error);
      return sendError(res, error.message || 'Failed to fetch reopen configuration', 500);
    }
  }

  /**
   * Update ticket reopen configuration
   * PUT /api/tickets/reopen-config
   */
  static async updateReopenConfig(req, res) {
    try {
      const {
        reopen_window_days,
        max_reopen_count,
        sla_reset_mode,
        require_reopen_reason,
        notify_assignee,
        notify_manager
      } = req.body;

      // Validation
      if (reopen_window_days !== undefined && (reopen_window_days < 1 || reopen_window_days > 365)) {
        return sendError(res, 'Reopen window must be between 1 and 365 days', 400);
      }

      if (max_reopen_count !== undefined && (max_reopen_count < 1 || max_reopen_count > 10)) {
        return sendError(res, 'Max reopen count must be between 1 and 10', 400);
      }

      if (sla_reset_mode && !['reset', 'continue', 'new_sla'].includes(sla_reset_mode)) {
        return sendError(res, 'Invalid SLA reset mode', 400);
      }

      const updatedBy = req.oauth.user.id;

      const config = await TicketModel.updateReopenConfig({
        reopen_window_days,
        max_reopen_count,
        sla_reset_mode,
        require_reopen_reason,
        notify_assignee,
        notify_manager
      }, updatedBy);

      return sendSuccess(res, config, 'Reopen configuration updated successfully');
    } catch (error) {
      console.error('Update reopen config error:', error);
      return sendError(res, error.message || 'Failed to update reopen configuration', 500);
    }
  }

  /**
   * Check if a ticket can be reopened
   * GET /api/tickets/:ticketId/can-reopen
   */
  static async canReopenTicket(req, res) {
    try {
      const { ticketId } = req.params;

      const result = await TicketModel.canReopenTicket(ticketId);

      return sendSuccess(res, result);
    } catch (error) {
      console.error('Check reopen eligibility error:', error);
      return sendError(res, error.message || 'Failed to check reopen eligibility', 500);
    }
  }

  /**
   * Reopen a closed ticket
   * POST /api/tickets/:ticketId/reopen
   */
  static async reopenTicket(req, res) {
    try {
      const { ticketId } = req.params;
      const { reopen_reason } = req.body;
      const reopenedBy = req.oauth.user.id;

      // Get config to check if reason is required
      const config = await TicketModel.getReopenConfig();

      if (config?.require_reopen_reason && !reopen_reason) {
        return sendError(res, 'Reopen reason is required', 400);
      }

      const ticket = await TicketModel.reopenTicket(ticketId, reopenedBy, reopen_reason || '');

      // Send notifications if ticket has an assigned engineer
      if (ticket.assigned_to_engineer_id) {
        try {
          // Create in-app notification
          await NotificationModel.createNotification({
            user_id: ticket.assigned_to_engineer_id,
            ticket_id: ticketId,
            notification_type: 'ticket_reopened',
            title: `Ticket Reopened: ${ticket.ticket_number}`,
            message: `Ticket "${ticket.title}" has been reopened and requires your attention.`,
            priority: 'high',
            related_data: {
              ticket_number: ticket.ticket_number,
              ticket_title: ticket.title,
              reopen_reason: reopen_reason || '',
              reopened_by: req.oauth.user.name || req.oauth.user.email || 'System'
            }
          });
          console.log(`Created reopen notification for ticket ${ticket.ticket_number}`);

          // Send email notification
          const engineerEmail = await TicketController.getEngineerEmail(ticket.assigned_to_engineer_id);
          if (engineerEmail) {
            const reopenedByName = req.oauth.user.name || req.oauth.user.email || 'System';
            const emailSubject = `Ticket Reopened: ${ticket.ticket_number}`;
            const emailBody = `
Hello,

A previously closed ticket has been reopened and requires your attention.

Ticket Number: ${ticket.ticket_number}
Title: ${ticket.title}
Priority: ${ticket.priority || 'medium'}
Status: ${ticket.status}
Reopened By: ${reopenedByName}
${reopen_reason ? `Reason: ${reopen_reason}` : ''}

Description:
${ticket.description || 'No description provided'}

This ticket has been reactivated and the SLA tracking has been resumed. Please review and take necessary action.

Please log in to the Unified ITSM Platform to view and work on this ticket.

This is an automated notification. Please do not reply to this email.
            `;

            await emailService.sendEmail(engineerEmail, emailSubject, emailBody.trim());
            console.log(`Reopen email sent to ${engineerEmail} for ticket ${ticket.ticket_number}`);
          }
        } catch (notificationError) {
          // Log but don't fail reopening if notification fails
          console.error('Failed to send reopen notification:', notificationError.message);
        }
      }

      return sendSuccess(res, ticket, 'Ticket reopened successfully');
    } catch (error) {
      console.error('Reopen ticket error:', error);
      return sendError(res, error.message || 'Failed to reopen ticket', 500);
    }
  }

  /**
   * Get reopen history for a ticket
   * GET /api/tickets/:ticketId/reopen-history
   */
  static async getReopenHistory(req, res) {
    try {
      const { ticketId } = req.params;

      const history = await TicketModel.getReopenHistory(ticketId);

      return sendSuccess(res, history);
    } catch (error) {
      console.error('Get reopen history error:', error);
      return sendError(res, error.message || 'Failed to fetch reopen history', 500);
    }
  }

  /**
   * Helper: Get engineer's email by user ID
   * @private
   */
  static async getEngineerEmail(engineerId) {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query('SELECT email FROM USER_MASTER WHERE user_id = @engineerId');

      if (result.recordset.length > 0) {
        return result.recordset[0].email;
      }
      return null;
    } catch (error) {
      console.error('Error fetching engineer email:', error);
      return null;
    }
  }
}

module.exports = TicketController;
