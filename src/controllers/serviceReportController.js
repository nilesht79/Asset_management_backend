/**
 * SERVICE REPORT CONTROLLER
 * Handles HTTP requests for service reports (repair/replace)
 */

const ServiceReportModel = require('../models/serviceReport');
const ServiceReportPDF = require('../utils/serviceReportPDF');
const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../utils/response');

class ServiceReportController {
  /**
   * Create a new service report
   * POST /api/service-reports
   */
  static async createReport(req, res) {
    try {
      const {
        ticket_id,
        service_type,
        asset_id,
        replacement_asset_id,
        diagnosis,
        work_performed,
        condition_before,
        condition_after,
        total_parts_cost,
        labor_cost,
        engineer_notes,
        parts_used
      } = req.body;

      // Validation
      if (!ticket_id) {
        return sendError(res, 'Ticket ID is required', 400);
      }

      if (!service_type || !['repair', 'replace'].includes(service_type)) {
        return sendError(res, 'Valid service type (repair/replace) is required', 400);
      }

      if (service_type === 'replace' && !replacement_asset_id) {
        return sendError(res, 'Replacement asset is required for replacement service', 400);
      }

      // Get user ID from authenticated user
      const created_by = req.oauth.user.id;

      const reportData = {
        ticket_id,
        service_type,
        asset_id,
        replacement_asset_id: service_type === 'replace' ? replacement_asset_id : null,
        diagnosis,
        work_performed,
        condition_before,
        condition_after,
        total_parts_cost: total_parts_cost || 0,
        labor_cost: labor_cost || 0,
        engineer_notes,
        created_by
      };

      const report = await ServiceReportModel.createReport(reportData, parts_used || []);

      return sendCreated(res, report, 'Service report created successfully');
    } catch (error) {
      console.error('Create service report error:', error);
      return sendError(res, error.message || 'Failed to create service report', 500);
    }
  }

  /**
   * Get service report by ID
   * GET /api/service-reports/:reportId
   */
  static async getReportById(req, res) {
    try {
      const { reportId } = req.params;

      const report = await ServiceReportModel.getReportById(reportId);

      if (!report) {
        return sendNotFound(res, 'Service report not found');
      }

      return sendSuccess(res, report);
    } catch (error) {
      console.error('Get service report error:', error);
      return sendError(res, error.message || 'Failed to fetch service report', 500);
    }
  }

  /**
   * Get service report by ticket ID
   * GET /api/service-reports/ticket/:ticketId
   */
  static async getReportByTicketId(req, res) {
    try {
      const { ticketId } = req.params;

      const report = await ServiceReportModel.getReportByTicketId(ticketId);

      if (!report) {
        return sendSuccess(res, null, 'No service report found for this ticket');
      }

      return sendSuccess(res, report);
    } catch (error) {
      console.error('Get service report by ticket error:', error);
      return sendError(res, error.message || 'Failed to fetch service report', 500);
    }
  }

  /**
   * Get all service reports with filters
   * GET /api/service-reports
   */
  static async getReports(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        service_type,
        asset_id,
        created_by,
        date_from,
        date_to,
        search
      } = req.query;

      const filters = {};
      if (service_type) filters.service_type = service_type;
      if (asset_id) filters.asset_id = asset_id;
      if (created_by) filters.created_by = created_by;
      if (date_from) filters.date_from = date_from;
      if (date_to) filters.date_to = date_to;
      if (search) filters.search = search;

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const result = await ServiceReportModel.getReports(filters, pagination);

      return sendSuccess(res, result);
    } catch (error) {
      console.error('Get service reports error:', error);
      return sendError(res, error.message || 'Failed to fetch service reports', 500);
    }
  }

  /**
   * Get spare parts consumption report
   * GET /api/service-reports/parts-consumption
   */
  static async getPartsConsumptionReport(req, res) {
    try {
      const { date_from, date_to, category_id } = req.query;

      const filters = {};
      if (date_from) filters.date_from = date_from;
      if (date_to) filters.date_to = date_to;
      if (category_id) filters.category_id = category_id;

      const report = await ServiceReportModel.getPartsConsumptionReport(filters);

      return sendSuccess(res, report);
    } catch (error) {
      console.error('Get parts consumption report error:', error);
      return sendError(res, error.message || 'Failed to fetch parts consumption report', 500);
    }
  }

  /**
   * Get available spare parts (component assets)
   * GET /api/service-reports/available-parts
   */
  static async getAvailableSpareParts(req, res) {
    try {
      const { category_id, location_id, search } = req.query;

      const filters = {};
      if (category_id) filters.category_id = category_id;
      if (location_id) filters.location_id = location_id;
      if (search) filters.search = search;

      const parts = await ServiceReportModel.getAvailableSpareParts(filters);

      return sendSuccess(res, { parts });
    } catch (error) {
      console.error('Get available spare parts error:', error);
      return sendError(res, error.message || 'Failed to fetch available spare parts', 500);
    }
  }

  /**
   * Get available replacement assets (standalone/parent assets)
   * GET /api/service-reports/available-replacement-assets
   */
  static async getAvailableReplacementAssets(req, res) {
    try {
      const { category_id, product_id, search } = req.query;

      const filters = {};
      if (category_id) filters.category_id = category_id;
      if (product_id) filters.product_id = product_id;
      if (search) filters.search = search;

      const assets = await ServiceReportModel.getAvailableReplacementAssets(filters);

      return sendSuccess(res, { assets });
    } catch (error) {
      console.error('Get available replacement assets error:', error);
      return sendError(res, error.message || 'Failed to fetch available replacement assets', 500);
    }
  }

  /**
   * Get detailed service reports with granular filters
   * GET /api/service-reports/detailed
   */
  static async getDetailedReports(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        date_from,
        date_to,
        service_type,
        engineer_id,
        location_id,
        department_id,
        search
      } = req.query;

      const filters = {};
      if (date_from) filters.date_from = date_from;
      if (date_to) filters.date_to = date_to;
      if (service_type) filters.service_type = service_type;
      if (engineer_id) filters.engineer_id = engineer_id;
      if (location_id) filters.location_id = location_id;
      if (department_id) filters.department_id = department_id;
      if (search) filters.search = search;

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const result = await ServiceReportModel.getServiceReportsDetailed(filters, pagination);

      return sendSuccess(res, result);
    } catch (error) {
      console.error('Get detailed service reports error:', error);
      return sendError(res, error.message || 'Failed to fetch detailed service reports', 500);
    }
  }

  /**
   * Generate PDF for a single service report
   * GET /api/service-reports/:reportId/pdf
   */
  static async generatePDF(req, res) {
    try {
      const { reportId } = req.params;

      const report = await ServiceReportModel.getReportForPDF(reportId);

      if (!report) {
        return sendNotFound(res, 'Service report not found');
      }

      const pdfBuffer = await ServiceReportPDF.generateSingleReport(report);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ServiceReport_${report.report_number}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);

      return res.send(pdfBuffer);
    } catch (error) {
      console.error('Generate PDF error:', error);
      return sendError(res, error.message || 'Failed to generate PDF', 500);
    }
  }

  /**
   * Generate PDF for multiple service reports (bulk)
   * POST /api/service-reports/pdf/bulk
   */
  static async generateBulkPDF(req, res) {
    try {
      const { report_ids } = req.body;

      if (!report_ids || !Array.isArray(report_ids) || report_ids.length === 0) {
        return sendError(res, 'report_ids array is required', 400);
      }

      if (report_ids.length > 50) {
        return sendError(res, 'Maximum 50 reports can be exported at once', 400);
      }

      const reports = await ServiceReportModel.getReportsForBulkPDF(report_ids);

      if (reports.length === 0) {
        return sendNotFound(res, 'No service reports found');
      }

      const pdfBuffer = await ServiceReportPDF.generateBulkReport(reports);

      const filename = `ServiceReports_Bulk_${new Date().toISOString().split('T')[0]}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);

      return res.send(pdfBuffer);
    } catch (error) {
      console.error('Generate bulk PDF error:', error);
      return sendError(res, error.message || 'Failed to generate bulk PDF', 500);
    }
  }
}

module.exports = ServiceReportController;
