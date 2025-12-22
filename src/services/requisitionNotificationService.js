/**
 * REQUISITION NOTIFICATION SERVICE
 * Handles in-app and email notifications for asset requisition workflow
 */

const { connectDB, sql } = require('../config/database');
const NotificationModel = require('../models/notification');
const emailService = require('./emailService');

class RequisitionNotificationService {
  /**
   * Notify Department Head when a new requisition is created
   * @param {Object} requisition - Requisition data
   */
  async notifyRequisitionCreated(requisition) {
    try {
      const {
        requisition_id,
        requisition_number,
        requester_name,
        department_name,
        purpose,
        urgency,
        dept_head_id
      } = requisition;

      if (!dept_head_id) {
        console.log(`No department head found for requisition ${requisition_number}`);
        return;
      }

      // Get department head email
      const pool = await connectDB();
      const deptHeadResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, dept_head_id)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const deptHead = deptHeadResult.recordset[0];
      if (!deptHead) return;

      // Create in-app notification
      await NotificationModel.createNotification({
        user_id: dept_head_id,
        ticket_id: null,
        notification_type: 'requisition_created',
        title: `New Requisition: ${requisition_number}`,
        message: `${requester_name} from ${department_name} has submitted a new asset requisition requiring your approval.`,
        priority: urgency === 'critical' || urgency === 'high' ? 'high' : 'medium',
        related_data: {
          requisition_id,
          requisition_number,
          requester_name,
          department_name,
          purpose,
          urgency,
          action_required: 'approve_or_reject'
        }
      });

      // Send email notification
      await this.sendRequisitionEmail({
        to: deptHead.email,
        subject: `[Action Required] New Asset Requisition ${requisition_number}`,
        recipientName: deptHead.first_name,
        requisition_number,
        requester_name,
        department_name,
        purpose,
        urgency,
        action: 'A new asset requisition requires your approval.',
        status: 'Pending Your Approval'
      });

      console.log(`Notified department head for requisition ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying requisition created:', error);
      // Don't throw - notification failure shouldn't block the main flow
    }
  }

  /**
   * Notify when Department Head approves requisition
   * @param {Object} requisition - Requisition data
   * @param {Object} approver - Approver user data
   */
  async notifyDeptHeadApproved(requisition, approver) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name,
        purpose,
        urgency
      } = requisition;

      const pool = await connectDB();

      // 1. Notify Employee (requester)
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (employee) {
        await NotificationModel.createNotification({
          user_id: requested_by,
          ticket_id: null,
          notification_type: 'requisition_approved',
          title: `Requisition Approved: ${requisition_number}`,
          message: `Your requisition has been approved by ${approver.firstName} ${approver.lastName} (Department Head). It is now pending IT Head approval.`,
          priority: 'medium',
          related_data: {
            requisition_id,
            requisition_number,
            approved_by: `${approver.firstName} ${approver.lastName}`,
            stage: 'pending_it_head'
          }
        });

        await this.sendRequisitionEmail({
          to: employee.email,
          subject: `Requisition ${requisition_number} Approved by Department Head`,
          recipientName: employee.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose,
          urgency,
          action: `Your requisition has been approved by ${approver.firstName} ${approver.lastName} (Department Head).`,
          status: 'Pending IT Head Approval'
        });
      }

      // 2. Notify IT Head
      const itHeadResult = await pool.request()
        .query(`SELECT user_id, email, first_name FROM USER_MASTER WHERE role = 'it_head' AND is_active = 1`);

      for (const itHead of itHeadResult.recordset) {
        await NotificationModel.createNotification({
          user_id: itHead.user_id,
          ticket_id: null,
          notification_type: 'requisition_pending_approval',
          title: `Requisition Pending: ${requisition_number}`,
          message: `A requisition from ${requester_name} (${department_name}) requires your approval. Already approved by Department Head.`,
          priority: urgency === 'critical' || urgency === 'high' ? 'high' : 'medium',
          related_data: {
            requisition_id,
            requisition_number,
            requester_name,
            department_name,
            purpose,
            urgency,
            action_required: 'approve_or_reject'
          }
        });

        await this.sendRequisitionEmail({
          to: itHead.email,
          subject: `[Action Required] Asset Requisition ${requisition_number} Pending IT Approval`,
          recipientName: itHead.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose,
          urgency,
          action: 'This requisition has been approved by the Department Head and now requires your approval.',
          status: 'Pending Your Approval'
        });
      }

      console.log(`Notified IT heads and employee for dept head approval of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying dept head approved:', error);
    }
  }

  /**
   * Notify when Department Head rejects requisition
   * @param {Object} requisition - Requisition data
   * @param {Object} approver - Approver user data
   * @param {string} comments - Rejection reason
   */
  async notifyDeptHeadRejected(requisition, approver, comments) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name,
        purpose
      } = requisition;

      const pool = await connectDB();
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (!employee) return;

      // In-app notification
      await NotificationModel.createNotification({
        user_id: requested_by,
        ticket_id: null,
        notification_type: 'requisition_rejected',
        title: `Requisition Rejected: ${requisition_number}`,
        message: `Your requisition has been rejected by ${approver.firstName} ${approver.lastName} (Department Head). Reason: ${comments}`,
        priority: 'high',
        related_data: {
          requisition_id,
          requisition_number,
          rejected_by: `${approver.firstName} ${approver.lastName}`,
          rejection_reason: comments,
          stage: 'rejected_by_dept_head'
        }
      });

      // Email notification
      await this.sendRequisitionEmail({
        to: employee.email,
        subject: `Requisition ${requisition_number} Rejected`,
        recipientName: employee.first_name,
        requisition_number,
        requester_name,
        department_name,
        purpose,
        urgency: 'N/A',
        action: `Your requisition has been rejected by ${approver.firstName} ${approver.lastName} (Department Head).\n\nReason: ${comments}`,
        status: 'Rejected'
      });

      console.log(`Notified employee for dept head rejection of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying dept head rejected:', error);
    }
  }

  /**
   * Notify when IT Head approves requisition
   * @param {Object} requisition - Requisition data
   * @param {Object} approver - Approver user data
   */
  async notifyITHeadApproved(requisition, approver) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name,
        purpose,
        urgency
      } = requisition;

      const pool = await connectDB();

      // 1. Notify Employee
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (employee) {
        await NotificationModel.createNotification({
          user_id: requested_by,
          ticket_id: null,
          notification_type: 'requisition_approved',
          title: `Requisition Fully Approved: ${requisition_number}`,
          message: `Your requisition has been approved by IT Head. Asset assignment is now in progress.`,
          priority: 'medium',
          related_data: {
            requisition_id,
            requisition_number,
            approved_by: `${approver.firstName} ${approver.lastName}`,
            stage: 'pending_assignment'
          }
        });

        await this.sendRequisitionEmail({
          to: employee.email,
          subject: `Requisition ${requisition_number} Fully Approved`,
          recipientName: employee.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose,
          urgency,
          action: `Great news! Your requisition has been fully approved by IT Head (${approver.firstName} ${approver.lastName}).`,
          status: 'Pending Asset Assignment'
        });
      }

      // 2. Notify All Coordinators (for assignment)
      const coordinatorResult = await pool.request()
        .query(`SELECT user_id, email, first_name FROM USER_MASTER WHERE role = 'coordinator' AND is_active = 1`);

      for (const coordinator of coordinatorResult.recordset) {
        await NotificationModel.createNotification({
          user_id: coordinator.user_id,
          ticket_id: null,
          notification_type: 'requisition_pending_assignment',
          title: `Requisition Ready for Assignment: ${requisition_number}`,
          message: `Requisition from ${requester_name} (${department_name}) is approved and ready for asset assignment.`,
          priority: urgency === 'critical' || urgency === 'high' ? 'high' : 'medium',
          related_data: {
            requisition_id,
            requisition_number,
            requester_name,
            department_name,
            purpose,
            urgency,
            action_required: 'assign_asset'
          }
        });

        await this.sendRequisitionEmail({
          to: coordinator.email,
          subject: `[Action Required] Requisition ${requisition_number} Ready for Assignment`,
          recipientName: coordinator.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose,
          urgency,
          action: 'This requisition has been fully approved and requires asset assignment.',
          status: 'Ready for Asset Assignment'
        });
      }

      console.log(`Notified coordinators and employee for IT head approval of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying IT head approved:', error);
    }
  }

  /**
   * Notify when IT Head rejects requisition
   * @param {Object} requisition - Requisition data
   * @param {Object} approver - Approver user data
   * @param {string} comments - Rejection reason
   */
  async notifyITHeadRejected(requisition, approver, comments) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name,
        purpose,
        dept_head_id
      } = requisition;

      const pool = await connectDB();

      // 1. Notify Employee
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (employee) {
        await NotificationModel.createNotification({
          user_id: requested_by,
          ticket_id: null,
          notification_type: 'requisition_rejected',
          title: `Requisition Rejected: ${requisition_number}`,
          message: `Your requisition has been rejected by IT Head (${approver.firstName} ${approver.lastName}). Reason: ${comments}`,
          priority: 'high',
          related_data: {
            requisition_id,
            requisition_number,
            rejected_by: `${approver.firstName} ${approver.lastName}`,
            rejection_reason: comments,
            stage: 'rejected_by_it_head'
          }
        });

        await this.sendRequisitionEmail({
          to: employee.email,
          subject: `Requisition ${requisition_number} Rejected by IT Head`,
          recipientName: employee.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose,
          urgency: 'N/A',
          action: `Your requisition has been rejected by IT Head (${approver.firstName} ${approver.lastName}).\n\nReason: ${comments}`,
          status: 'Rejected'
        });
      }

      // 2. Notify Department Head (informational)
      if (dept_head_id) {
        const deptHeadResult = await pool.request()
          .input('userId', sql.UniqueIdentifier, dept_head_id)
          .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

        const deptHead = deptHeadResult.recordset[0];
        if (deptHead) {
          await NotificationModel.createNotification({
            user_id: dept_head_id,
            ticket_id: null,
            notification_type: 'requisition_rejected',
            title: `Requisition Rejected by IT: ${requisition_number}`,
            message: `A requisition you approved from ${requester_name} has been rejected by IT Head. Reason: ${comments}`,
            priority: 'medium',
            related_data: {
              requisition_id,
              requisition_number,
              rejected_by: `${approver.firstName} ${approver.lastName}`,
              rejection_reason: comments
            }
          });
        }
      }

      console.log(`Notified employee and dept head for IT head rejection of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying IT head rejected:', error);
    }
  }

  /**
   * Notify when asset is assigned to requisition
   * @param {Object} requisition - Requisition data
   * @param {Object} assignmentData - Assignment details
   */
  async notifyAssetAssigned(requisition, assignmentData) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name
      } = requisition;

      const {
        asset_tag,
        engineer_id,
        engineer_name,
        coordinator_name,
        installation_scheduled_date
      } = assignmentData;

      const pool = await connectDB();

      // 1. Notify Employee
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (employee) {
        const scheduleInfo = installation_scheduled_date
          ? `Scheduled for: ${new Date(installation_scheduled_date).toLocaleDateString()}`
          : 'Delivery will be scheduled soon.';

        await NotificationModel.createNotification({
          user_id: requested_by,
          ticket_id: null,
          notification_type: 'requisition_asset_assigned',
          title: `Asset Assigned: ${requisition_number}`,
          message: `An asset (${asset_tag}) has been assigned to your requisition. Engineer ${engineer_name} will handle the delivery and installation. ${scheduleInfo}`,
          priority: 'high',
          related_data: {
            requisition_id,
            requisition_number,
            asset_tag,
            engineer_name,
            installation_scheduled_date,
            stage: 'assigned'
          }
        });

        await this.sendRequisitionEmail({
          to: employee.email,
          subject: `Asset Assigned to Requisition ${requisition_number}`,
          recipientName: employee.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose: `Asset: ${asset_tag}`,
          urgency: 'N/A',
          action: `An asset (${asset_tag}) has been assigned to your requisition by ${coordinator_name}.\n\nEngineer ${engineer_name} will handle the delivery and installation.\n${scheduleInfo}`,
          status: 'Asset Assigned - Pending Delivery'
        });
      }

      // 2. Notify Engineer
      if (engineer_id) {
        const engineerResult = await pool.request()
          .input('userId', sql.UniqueIdentifier, engineer_id)
          .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

        const engineer = engineerResult.recordset[0];
        if (engineer) {
          const scheduleInfo = installation_scheduled_date
            ? `Scheduled Date: ${new Date(installation_scheduled_date).toLocaleDateString()}`
            : 'Please coordinate with the employee for delivery.';

          await NotificationModel.createNotification({
            user_id: engineer_id,
            ticket_id: null,
            notification_type: 'requisition_delivery_assigned',
            title: `Delivery Assignment: ${requisition_number}`,
            message: `You have been assigned to deliver and install asset ${asset_tag} for ${requester_name} (${department_name}). ${scheduleInfo}`,
            priority: 'high',
            related_data: {
              requisition_id,
              requisition_number,
              asset_tag,
              requester_name,
              department_name,
              installation_scheduled_date,
              action_required: 'deliver_and_install'
            }
          });

          await this.sendRequisitionEmail({
            to: engineer.email,
            subject: `[Action Required] Delivery Assignment - ${requisition_number}`,
            recipientName: engineer.first_name,
            requisition_number,
            requester_name,
            department_name,
            purpose: `Deliver and install asset: ${asset_tag}`,
            urgency: 'High',
            action: `You have been assigned to deliver and install asset ${asset_tag} for ${requester_name} (${department_name}).\n\n${scheduleInfo}`,
            status: 'Pending Delivery'
          });
        }
      }

      console.log(`Notified employee and engineer for asset assignment of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying asset assigned:', error);
    }
  }

  /**
   * Notify when asset is delivered
   * @param {Object} requisition - Requisition data
   * @param {Object} deliveryData - Delivery details
   */
  async notifyAssetDelivered(requisition, deliveryData) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name,
        assigned_asset_tag
      } = requisition;

      const { delivered_by_name } = deliveryData;

      const pool = await connectDB();
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (!employee) return;

      await NotificationModel.createNotification({
        user_id: requested_by,
        ticket_id: null,
        notification_type: 'requisition_delivered',
        title: `Asset Delivered: ${requisition_number}`,
        message: `Your asset (${assigned_asset_tag}) has been delivered by ${delivered_by_name}. Please confirm receipt.`,
        priority: 'high',
        related_data: {
          requisition_id,
          requisition_number,
          asset_tag: assigned_asset_tag,
          delivered_by: delivered_by_name,
          stage: 'delivered',
          action_required: 'confirm_receipt'
        }
      });

      await this.sendRequisitionEmail({
        to: employee.email,
        subject: `Asset Delivered - ${requisition_number}`,
        recipientName: employee.first_name,
        requisition_number,
        requester_name,
        department_name,
        purpose: `Asset: ${assigned_asset_tag}`,
        urgency: 'N/A',
        action: `Your asset (${assigned_asset_tag}) has been delivered by ${delivered_by_name}.\n\nPlease log in to the system to confirm receipt of the asset.`,
        status: 'Delivered - Pending Confirmation'
      });

      console.log(`Notified employee for delivery of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying asset delivered:', error);
    }
  }

  /**
   * Notify when requisition is completed
   * @param {Object} requisition - Requisition data
   */
  async notifyRequisitionCompleted(requisition) {
    try {
      const {
        requisition_id,
        requisition_number,
        requested_by,
        requester_name,
        department_name,
        assigned_asset_tag,
        assigned_coordinator_id
      } = requisition;

      const pool = await connectDB();

      // 1. Notify Employee
      const employeeResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, requested_by)
        .query('SELECT email, first_name FROM USER_MASTER WHERE user_id = @userId');

      const employee = employeeResult.recordset[0];
      if (employee) {
        await NotificationModel.createNotification({
          user_id: requested_by,
          ticket_id: null,
          notification_type: 'requisition_completed',
          title: `Requisition Completed: ${requisition_number}`,
          message: `Your asset requisition has been completed. Asset ${assigned_asset_tag} is now assigned to you.`,
          priority: 'low',
          related_data: {
            requisition_id,
            requisition_number,
            asset_tag: assigned_asset_tag,
            stage: 'completed'
          }
        });

        await this.sendRequisitionEmail({
          to: employee.email,
          subject: `Requisition Completed - ${requisition_number}`,
          recipientName: employee.first_name,
          requisition_number,
          requester_name,
          department_name,
          purpose: `Asset: ${assigned_asset_tag}`,
          urgency: 'N/A',
          action: `Your asset requisition has been completed successfully. Asset ${assigned_asset_tag} is now officially assigned to you.`,
          status: 'Completed'
        });
      }

      // 2. Notify Coordinator
      if (assigned_coordinator_id) {
        await NotificationModel.createNotification({
          user_id: assigned_coordinator_id,
          ticket_id: null,
          notification_type: 'requisition_completed',
          title: `Requisition Completed: ${requisition_number}`,
          message: `Requisition for ${requester_name} has been completed. Asset ${assigned_asset_tag} delivered and confirmed.`,
          priority: 'low',
          related_data: {
            requisition_id,
            requisition_number,
            asset_tag: assigned_asset_tag,
            requester_name,
            stage: 'completed'
          }
        });
      }

      console.log(`Notified employee and coordinator for completion of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying requisition completed:', error);
    }
  }

  /**
   * Notify when requisition is cancelled
   * @param {Object} requisition - Requisition data (before cancellation)
   * @param {string} cancelledBy - Who cancelled
   * @param {string} reason - Cancellation reason
   */
  async notifyRequisitionCancelled(requisition, cancelledBy, reason) {
    try {
      const {
        requisition_id,
        requisition_number,
        requester_name,
        department_name,
        status,
        dept_head_id,
        it_head_id
      } = requisition;

      const pool = await connectDB();

      // Notify relevant approvers based on status
      const usersToNotify = [];

      // If pending dept head approval, notify dept head
      if (status === 'pending_dept_head' && dept_head_id) {
        usersToNotify.push(dept_head_id);
      }

      // If pending IT head approval, notify IT head
      if (status === 'pending_it_head' && it_head_id) {
        usersToNotify.push(it_head_id);
      }

      for (const userId of usersToNotify) {
        await NotificationModel.createNotification({
          user_id: userId,
          ticket_id: null,
          notification_type: 'requisition_cancelled',
          title: `Requisition Cancelled: ${requisition_number}`,
          message: `Requisition from ${requester_name} (${department_name}) has been cancelled. Reason: ${reason || 'No reason provided'}`,
          priority: 'low',
          related_data: {
            requisition_id,
            requisition_number,
            cancelled_by: cancelledBy,
            cancellation_reason: reason
          }
        });
      }

      console.log(`Notified approvers for cancellation of ${requisition_number}`);
    } catch (error) {
      console.error('Error notifying requisition cancelled:', error);
    }
  }

  /**
   * Send requisition email using email service
   * @param {Object} emailData - Email data
   */
  async sendRequisitionEmail(emailData) {
    try {
      const {
        to,
        subject,
        recipientName,
        requisition_number,
        requester_name,
        department_name,
        purpose,
        urgency,
        action,
        status
      } = emailData;

      const body = `
ASSET REQUISITION NOTIFICATION
==============================

Hello ${recipientName},

${action}

Requisition Details:
-------------------
Requisition Number: ${requisition_number}
Requester: ${requester_name}
Department: ${department_name}
Purpose: ${purpose}
Urgency: ${urgency}
Current Status: ${status}

Please log in to the Unified ITSM Platform to take action or view more details.

---
This is an automated notification from the Unified ITSM Platform.
Please do not reply to this email.
`;

      await emailService.sendEmail(to, subject, body);
    } catch (error) {
      console.error('Error sending requisition email:', error);
      // Don't throw - email failure shouldn't block notifications
    }
  }
}

module.exports = new RequisitionNotificationService();
