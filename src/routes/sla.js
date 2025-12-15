/**
 * SLA ROUTES
 * API endpoints for SLA management
 */

const express = require('express');
const router = express.Router();
const SlaController = require('../controllers/slaController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// ==================== SLA RULES ====================

// Get all SLA rules
router.get('/rules', SlaController.getAllRules);

// Get SLA rule by ID
router.get('/rules/:ruleId', SlaController.getRuleById);

// Create SLA rule (admin/superadmin only)
router.post('/rules',
  requireRoles('admin', 'superadmin'),
  SlaController.createRule
);

// Update SLA rule (admin/superadmin only)
router.put('/rules/:ruleId',
  requireRoles('admin', 'superadmin'),
  SlaController.updateRule
);

// Delete SLA rule (admin/superadmin only)
router.delete('/rules/:ruleId',
  requireRoles('admin', 'superadmin'),
  SlaController.deleteRule
);

// Get escalation rules for an SLA rule
router.get('/rules/:ruleId/escalations', SlaController.getEscalationRulesForSla);

// ==================== BUSINESS HOURS ====================

// Get all business hours schedules
router.get('/business-hours', SlaController.getBusinessHoursSchedules);

// Get business hours schedule details
router.get('/business-hours/:scheduleId', SlaController.getBusinessHoursDetails);

// Save business hours schedule (admin/superadmin only)
router.post('/business-hours',
  requireRoles('admin', 'superadmin'),
  SlaController.saveBusinessHoursSchedule
);

// Delete business hours schedule (admin/superadmin only)
router.delete('/business-hours/:scheduleId',
  requireRoles('admin', 'superadmin'),
  SlaController.deleteBusinessHoursSchedule
);

// ==================== HOLIDAY CALENDARS ====================

// Get all holiday calendars
router.get('/holidays', SlaController.getHolidayCalendars);

// Get holiday dates for a calendar
router.get('/holidays/:calendarId/dates', SlaController.getHolidayDates);

// Save holiday calendar (admin/superadmin only)
router.post('/holidays',
  requireRoles('admin', 'superadmin'),
  SlaController.saveHolidayCalendar
);

// Delete holiday calendar (admin/superadmin only)
router.delete('/holidays/:calendarId',
  requireRoles('admin', 'superadmin'),
  SlaController.deleteHolidayCalendar
);

// ==================== ESCALATION RULES ====================

// Get available designations for escalation rules
router.get('/designations', SlaController.getDesignations);

// Get available roles for escalation rules
router.get('/roles', SlaController.getRoles);

// Save escalation rule (admin/superadmin only)
router.post('/escalation-rules',
  requireRoles('admin', 'superadmin'),
  SlaController.saveEscalationRule
);

// Delete escalation rule (admin/superadmin only)
router.delete('/escalation-rules/:escalationRuleId',
  requireRoles('admin', 'superadmin'),
  SlaController.deleteEscalationRule
);

// ==================== SLA TRACKING ====================

// Get SLA tracking for a ticket
router.get('/tracking/:ticketId', SlaController.getTicketSlaTracking);

// Pause SLA timer (coordinator, admin, superadmin)
router.post('/tracking/:ticketId/pause',
  requireRoles('admin', 'superadmin', 'coordinator'),
  SlaController.pauseSlaTimer
);

// Resume SLA timer (coordinator, admin, superadmin)
router.post('/tracking/:ticketId/resume',
  requireRoles('admin', 'superadmin', 'coordinator'),
  SlaController.resumeSlaTimer
);

// ==================== DASHBOARD & METRICS ====================

// Get SLA dashboard data
router.get('/dashboard', SlaController.getDashboard);

// Get SLA metrics
router.get('/metrics', SlaController.getMetrics);

// Get bulk SLA summary for multiple tickets
router.post('/bulk-summary', SlaController.getBulkSlaSummary);

// ==================== ADMIN TRIGGERS ====================

// Manually trigger escalation processing (admin/superadmin only)
router.post('/trigger/escalations',
  requireRoles('admin', 'superadmin'),
  SlaController.triggerEscalationProcessing
);

// Manually trigger notification processing (admin/superadmin only)
router.post('/trigger/notifications',
  requireRoles('admin', 'superadmin'),
  SlaController.triggerNotificationProcessing
);

// Update all active SLA tracking (admin/superadmin only, for cron jobs)
router.post('/trigger/update-all',
  requireRoles('admin', 'superadmin'),
  SlaController.updateAllTracking
);

module.exports = router;
