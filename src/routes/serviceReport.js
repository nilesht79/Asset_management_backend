/**
 * SERVICE REPORT ROUTES
 * API endpoints for service reports (repair/replace)
 */

const express = require('express');
const router = express.Router();
const ServiceReportController = require('../controllers/serviceReportController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get available spare parts (component assets)
// GET /api/service-reports/available-parts
router.get('/available-parts', ServiceReportController.getAvailableSpareParts);

// Get available replacement assets (standalone/parent assets)
// GET /api/service-reports/available-replacement-assets
router.get('/available-replacement-assets', ServiceReportController.getAvailableReplacementAssets);

// Get spare parts consumption report
// GET /api/service-reports/parts-consumption
router.get('/parts-consumption', ServiceReportController.getPartsConsumptionReport);

// Get detailed service reports with granular filters (for Service Reports page)
// GET /api/service-reports/detailed
router.get('/detailed', ServiceReportController.getDetailedReports);

// Generate bulk PDF for multiple reports
// POST /api/service-reports/pdf/bulk
router.post('/pdf/bulk', ServiceReportController.generateBulkPDF);

// Get draft service report by ticket ID
// GET /api/service-reports/draft/ticket/:ticketId
router.get('/draft/ticket/:ticketId', ServiceReportController.getDraftReportByTicketId);

// Create draft service report (for close request workflow)
// POST /api/service-reports/draft
router.post('/draft',
  requireRoles('engineer', 'coordinator', 'admin', 'superadmin'),
  ServiceReportController.createDraftReport
);

// Get service report by ticket ID
// GET /api/service-reports/ticket/:ticketId
router.get('/ticket/:ticketId', ServiceReportController.getReportByTicketId);

// Generate PDF for single report (must be before /:reportId to avoid conflict)
// GET /api/service-reports/:reportId/pdf
router.get('/:reportId/pdf', ServiceReportController.generatePDF);

// Get all service reports with filters
// GET /api/service-reports
router.get('/', ServiceReportController.getReports);

// Get service report by ID
// GET /api/service-reports/:reportId
router.get('/:reportId', ServiceReportController.getReportById);

// Create a new service report (engineers, coordinators, admins)
// POST /api/service-reports
router.post('/',
  requireRoles('engineer', 'coordinator', 'admin', 'superadmin'),
  ServiceReportController.createReport
);

module.exports = router;
