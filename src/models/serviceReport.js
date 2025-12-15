/**
 * SERVICE REPORT MODEL
 * Handles database operations for service reports (repair/replace)
 */

const { connectDB, sql } = require('../config/database');

class ServiceReportModel {
  /**
   * Generate unique service report number
   * Format: SR-YYYY-NNNN (e.g., SR-2025-0001)
   */
  static async generateReportNumber() {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .output('ReportNumber', sql.VarChar(20))
        .execute('sp_GenerateServiceReportNumber');

      return result.output.ReportNumber;
    } catch (error) {
      console.error('Error generating report number:', error);
      throw new Error('Failed to generate service report number');
    }
  }

  /**
   * Create a new service report
   */
  static async createReport(reportData, partsUsed = []) {
    const pool = await connectDB();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Generate report number
      const reportNumberResult = await transaction.request()
        .output('ReportNumber', sql.VarChar(20))
        .execute('sp_GenerateServiceReportNumber');

      const reportNumber = reportNumberResult.output.ReportNumber;

      // Insert service report
      const insertReportQuery = `
        INSERT INTO SERVICE_REPORTS (
          report_id,
          report_number,
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
          created_by,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @reportNumber,
          @ticketId,
          @serviceType,
          @assetId,
          @replacementAssetId,
          @diagnosis,
          @workPerformed,
          @conditionBefore,
          @conditionAfter,
          @totalPartsCost,
          @laborCost,
          @engineerNotes,
          @createdBy,
          GETDATE(),
          GETDATE()
        )
      `;

      const reportResult = await transaction.request()
        .input('reportNumber', sql.VarChar(20), reportNumber)
        .input('ticketId', sql.UniqueIdentifier, reportData.ticket_id)
        .input('serviceType', sql.VarChar(20), reportData.service_type)
        .input('assetId', sql.UniqueIdentifier, reportData.asset_id || null)
        .input('replacementAssetId', sql.UniqueIdentifier, reportData.replacement_asset_id || null)
        .input('diagnosis', sql.NVarChar(sql.MAX), reportData.diagnosis || null)
        .input('workPerformed', sql.NVarChar(sql.MAX), reportData.work_performed || null)
        .input('conditionBefore', sql.VarChar(50), reportData.condition_before || null)
        .input('conditionAfter', sql.VarChar(50), reportData.condition_after || null)
        .input('totalPartsCost', sql.Decimal(15, 2), reportData.total_parts_cost || 0)
        .input('laborCost', sql.Decimal(15, 2), reportData.labor_cost || 0)
        .input('engineerNotes', sql.NVarChar(sql.MAX), reportData.engineer_notes || null)
        .input('createdBy', sql.UniqueIdentifier, reportData.created_by)
        .query(insertReportQuery);

      const report = reportResult.recordset[0];

      // Insert parts used
      if (partsUsed && partsUsed.length > 0) {
        for (const part of partsUsed) {
          await transaction.request()
            .input('reportId', sql.UniqueIdentifier, report.report_id)
            .input('assetId', sql.UniqueIdentifier, part.asset_id)
            .input('quantity', sql.Int, part.quantity || 1)
            .input('unitCost', sql.Decimal(15, 2), part.unit_cost || 0)
            .input('notes', sql.NVarChar(500), part.notes || null)
            .query(`
              INSERT INTO SERVICE_REPORT_PARTS (
                part_id, report_id, asset_id, quantity, unit_cost, notes, created_at
              ) VALUES (
                NEWID(), @reportId, @assetId, @quantity, @unitCost, @notes, GETDATE()
              )
            `);

          // Update the component asset - set parent_asset_id and status
          if (reportData.asset_id) {
            await transaction.request()
              .input('componentAssetId', sql.UniqueIdentifier, part.asset_id)
              .input('parentAssetId', sql.UniqueIdentifier, reportData.asset_id)
              .query(`
                UPDATE assets
                SET
                  parent_asset_id = @parentAssetId,
                  status = 'in_use',
                  installation_date = GETDATE(),
                  updated_at = GETDATE()
                WHERE id = @componentAssetId AND asset_type = 'component'
              `);
          }
        }
      }

      // Update the main asset's condition_status if repair
      if (reportData.service_type === 'repair' && reportData.asset_id && reportData.condition_after) {
        await transaction.request()
          .input('assetId', sql.UniqueIdentifier, reportData.asset_id)
          .input('conditionAfter', sql.VarChar(50), reportData.condition_after)
          .query(`
            UPDATE assets
            SET
              condition_status = @conditionAfter,
              updated_at = GETDATE()
            WHERE id = @assetId
          `);
      }

      // Handle replacement - create asset movement record
      if (reportData.service_type === 'replace' && reportData.asset_id && reportData.replacement_asset_id) {
        // Get the old asset's assigned user
        const oldAssetResult = await transaction.request()
          .input('oldAssetId', sql.UniqueIdentifier, reportData.asset_id)
          .query(`
            SELECT assigned_to, status FROM assets WHERE id = @oldAssetId
          `);

        const oldAsset = oldAssetResult.recordset[0];
        const assignedTo = oldAsset?.assigned_to;

        // Update old asset - mark as retired/replaced
        await transaction.request()
          .input('oldAssetId', sql.UniqueIdentifier, reportData.asset_id)
          .input('replacementAssetId', sql.UniqueIdentifier, reportData.replacement_asset_id)
          .query(`
            UPDATE assets
            SET
              status = 'retired',
              replacement_asset_id = @replacementAssetId,
              updated_at = GETDATE()
            WHERE id = @oldAssetId
          `);

        // Update new asset - assign to user
        // Note: 'assigned' status for standalone/parent assets, 'in_use' is only for components
        if (assignedTo) {
          await transaction.request()
            .input('newAssetId', sql.UniqueIdentifier, reportData.replacement_asset_id)
            .input('assignedTo', sql.UniqueIdentifier, assignedTo)
            .query(`
              UPDATE assets
              SET
                assigned_to = @assignedTo,
                status = CASE
                  WHEN asset_type = 'component' THEN 'in_use'
                  ELSE 'assigned'
                END,
                updated_at = GETDATE()
              WHERE id = @newAssetId
            `);
        }

        // Create ASSET_MOVEMENTS record for the replacement
        // Get additional details for the movement record
        const movementDetailsResult = await transaction.request()
          .input('newAssetId', sql.UniqueIdentifier, reportData.replacement_asset_id)
          .input('assignedToId', sql.UniqueIdentifier, assignedTo)
          .input('performedById', sql.UniqueIdentifier, reportData.created_by)
          .query(`
            SELECT
              a.asset_tag,
              u.first_name + ' ' + u.last_name AS assigned_to_name,
              p.first_name + ' ' + p.last_name AS performed_by_name
            FROM assets a
            LEFT JOIN USER_MASTER u ON u.user_id = @assignedToId
            LEFT JOIN USER_MASTER p ON p.user_id = @performedById
            WHERE a.id = @newAssetId
          `);

        const movementDetails = movementDetailsResult.recordset[0] || {};

        await transaction.request()
          .input('assetId', sql.UniqueIdentifier, reportData.replacement_asset_id)
          .input('assetTag', sql.VarChar(100), movementDetails.asset_tag || null)
          .input('assignedTo', sql.UniqueIdentifier, assignedTo)
          .input('assignedToName', sql.NVarChar(200), movementDetails.assigned_to_name || null)
          .input('movementType', sql.VarChar(50), 'assigned')
          .input('status', sql.VarChar(50), 'assigned')
          .input('notes', sql.NVarChar(sql.MAX), `Replacement asset assigned (Service Report: ${reportNumber})`)
          .input('performedBy', sql.UniqueIdentifier, reportData.created_by)
          .input('performedByName', sql.NVarChar(200), movementDetails.performed_by_name || null)
          .query(`
            INSERT INTO ASSET_MOVEMENTS (
              id, asset_id, asset_tag,
              assigned_to, assigned_to_name,
              movement_type, status,
              movement_date, notes,
              performed_by, performed_by_name,
              created_at
            ) VALUES (
              NEWID(), @assetId, @assetTag,
              @assignedTo, @assignedToName,
              @movementType, @status,
              GETDATE(), @notes,
              @performedBy, @performedByName,
              GETDATE()
            )
          `);
      }

      await transaction.commit();

      // Return full report with details
      return await this.getReportById(report.report_id);
    } catch (error) {
      await transaction.rollback();
      console.error('Error creating service report:', error);
      throw error;
    }
  }

  /**
   * Get service report by ID
   */
  static async getReportById(reportId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          sr.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.status AS ticket_status,
          -- Main asset details
          a.asset_tag AS asset_tag,
          p.name AS asset_product_name,
          -- Replacement asset details
          ra.asset_tag AS replacement_asset_tag,
          rp.name AS replacement_product_name,
          -- Created by user
          u.first_name + ' ' + u.last_name AS created_by_name,
          u.email AS created_by_email
        FROM SERVICE_REPORTS sr
        LEFT JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN assets ra ON sr.replacement_asset_id = ra.id
        LEFT JOIN products rp ON ra.product_id = rp.id
        LEFT JOIN USER_MASTER u ON sr.created_by = u.user_id
        WHERE sr.report_id = @reportId
      `;

      const result = await pool.request()
        .input('reportId', sql.UniqueIdentifier, reportId)
        .query(query);

      const report = result.recordset[0];

      if (report) {
        // Get parts used
        const partsQuery = `
          SELECT
            srp.*,
            a.asset_tag,
            a.serial_number,
            p.name AS product_name,
            c.name AS category_name
          FROM SERVICE_REPORT_PARTS srp
          LEFT JOIN assets a ON srp.asset_id = a.id
          LEFT JOIN products p ON a.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE srp.report_id = @reportId
        `;

        const partsResult = await pool.request()
          .input('reportId', sql.UniqueIdentifier, reportId)
          .query(partsQuery);

        report.parts_used = partsResult.recordset;
      }

      return report || null;
    } catch (error) {
      console.error('Error fetching service report:', error);
      throw error;
    }
  }

  /**
   * Get service report by ticket ID
   */
  static async getReportByTicketId(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT report_id FROM SERVICE_REPORTS WHERE ticket_id = @ticketId
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      if (result.recordset.length > 0) {
        return await this.getReportById(result.recordset[0].report_id);
      }

      return null;
    } catch (error) {
      console.error('Error fetching service report by ticket:', error);
      throw error;
    }
  }

  /**
   * Get all service reports with filters
   */
  static async getReports(filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();

      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.service_type) {
        whereClause += ' AND sr.service_type = @serviceType';
        params.serviceType = filters.service_type;
      }

      if (filters.asset_id) {
        whereClause += ' AND sr.asset_id = @assetId';
        params.assetId = filters.asset_id;
      }

      if (filters.created_by) {
        whereClause += ' AND sr.created_by = @createdBy';
        params.createdBy = filters.created_by;
      }

      if (filters.date_from) {
        whereClause += ' AND sr.created_at >= @dateFrom';
        params.dateFrom = filters.date_from;
      }

      if (filters.date_to) {
        whereClause += ' AND sr.created_at <= @dateTo';
        params.dateTo = filters.date_to;
      }

      if (filters.search) {
        whereClause += ` AND (
          sr.report_number LIKE @search
          OR t.ticket_number LIKE @search
          OR a.asset_tag LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      const query = `
        SELECT
          sr.*,
          t.ticket_number,
          t.title AS ticket_title,
          a.asset_tag,
          p.name AS asset_product_name,
          u.first_name + ' ' + u.last_name AS created_by_name
        FROM SERVICE_REPORTS sr
        LEFT JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER u ON sr.created_by = u.user_id
        ${whereClause}
        ORDER BY sr.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total
        FROM SERVICE_REPORTS sr
        LEFT JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        ${whereClause}
      `;

      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      Object.keys(params).forEach(key => {
        if (key === 'assetId' || key === 'createdBy') {
          request.input(key, sql.UniqueIdentifier, params[key]);
        } else if (key === 'dateFrom' || key === 'dateTo') {
          request.input(key, sql.DateTime, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      let countRequest = pool.request();
      Object.keys(params).forEach(key => {
        if (key === 'assetId' || key === 'createdBy') {
          countRequest.input(key, sql.UniqueIdentifier, params[key]);
        } else if (key === 'dateFrom' || key === 'dateTo') {
          countRequest.input(key, sql.DateTime, params[key]);
        } else {
          countRequest.input(key, sql.VarChar, params[key]);
        }
      });

      const [reportsResult, countResult] = await Promise.all([
        request.query(query),
        countRequest.query(countQuery)
      ]);

      return {
        reports: reportsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0]?.total || 0,
          pages: Math.ceil((countResult.recordset[0]?.total || 0) / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching service reports:', error);
      throw error;
    }
  }

  /**
   * Get spare parts consumption summary (for reports)
   */
  static async getPartsConsumptionReport(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.date_from) {
        whereClause += ' AND sr.created_at >= @dateFrom';
        params.dateFrom = filters.date_from;
      }

      if (filters.date_to) {
        whereClause += ' AND sr.created_at <= @dateTo';
        params.dateTo = filters.date_to;
      }

      if (filters.category_id) {
        whereClause += ' AND p.category_id = @categoryId';
        params.categoryId = filters.category_id;
      }

      // Summary by product/category
      const summaryQuery = `
        SELECT
          p.name AS product_name,
          c.name AS category_name,
          COUNT(*) AS total_units_used,
          SUM(srp.quantity) AS total_quantity,
          SUM(srp.quantity * srp.unit_cost) AS total_cost
        FROM SERVICE_REPORT_PARTS srp
        INNER JOIN SERVICE_REPORTS sr ON srp.report_id = sr.report_id
        INNER JOIN assets a ON srp.asset_id = a.id
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        ${whereClause}
        GROUP BY p.id, p.name, c.name
        ORDER BY total_quantity DESC
      `;

      // Detailed list
      const detailQuery = `
        SELECT
          sr.report_number,
          sr.created_at,
          t.ticket_number,
          a.asset_tag AS main_asset,
          pa.asset_tag AS part_asset_tag,
          pa.serial_number AS part_serial_number,
          pp.name AS part_product_name,
          c.name AS part_category,
          srp.quantity,
          srp.unit_cost,
          (srp.quantity * srp.unit_cost) AS total_cost,
          u.first_name + ' ' + u.last_name AS engineer_name
        FROM SERVICE_REPORT_PARTS srp
        INNER JOIN SERVICE_REPORTS sr ON srp.report_id = sr.report_id
        INNER JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        INNER JOIN assets pa ON srp.asset_id = pa.id
        INNER JOIN products pp ON pa.product_id = pp.id
        LEFT JOIN categories c ON pp.category_id = c.id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        ${whereClause}
        ORDER BY sr.created_at DESC
      `;

      let summaryRequest = pool.request();
      let detailRequest = pool.request();

      Object.keys(params).forEach(key => {
        if (key === 'categoryId') {
          summaryRequest.input(key, sql.UniqueIdentifier, params[key]);
          detailRequest.input(key, sql.UniqueIdentifier, params[key]);
        } else if (key === 'dateFrom' || key === 'dateTo') {
          summaryRequest.input(key, sql.DateTime, params[key]);
          detailRequest.input(key, sql.DateTime, params[key]);
        } else {
          summaryRequest.input(key, sql.VarChar, params[key]);
          detailRequest.input(key, sql.VarChar, params[key]);
        }
      });

      const [summaryResult, detailResult] = await Promise.all([
        summaryRequest.query(summaryQuery),
        detailRequest.query(detailQuery)
      ]);

      return {
        summary: summaryResult.recordset,
        details: detailResult.recordset
      };
    } catch (error) {
      console.error('Error fetching parts consumption report:', error);
      throw error;
    }
  }

  /**
   * Get detailed service reports with granular filters
   * Used for Service Reports page with full details
   */
  static async getServiceReportsDetailed(filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();

      const { page = 1, limit = 20 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      // Date filters
      if (filters.date_from) {
        whereClause += ' AND sr.created_at >= @dateFrom';
        params.dateFrom = filters.date_from;
      }

      if (filters.date_to) {
        whereClause += " AND sr.created_at < DATEADD(day, 1, @dateTo)";
        params.dateTo = filters.date_to;
      }

      // Service type filter
      if (filters.service_type) {
        whereClause += ' AND sr.service_type = @serviceType';
        params.serviceType = filters.service_type;
      }

      // Engineer filter (assigned to ticket)
      if (filters.engineer_id) {
        whereClause += ' AND t.assigned_to_engineer_id = @engineerId';
        params.engineerId = filters.engineer_id;
      }

      // Location filter (from ticket)
      if (filters.location_id) {
        whereClause += ' AND t.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      // Department filter (from ticket)
      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      // Search filter
      if (filters.search) {
        whereClause += ` AND (
          sr.report_number LIKE @search
          OR t.ticket_number LIKE @search
          OR a.asset_tag LIKE @search
          OR p.name LIKE @search
          OR eng.first_name + ' ' + eng.last_name LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      // Main query for detailed service reports
      const query = `
        SELECT
          sr.report_id,
          sr.report_number,
          sr.service_type,
          sr.diagnosis,
          sr.work_performed,
          sr.condition_before,
          sr.condition_after,
          sr.total_parts_cost,
          sr.labor_cost,
          sr.engineer_notes,
          sr.created_at,
          -- Ticket details
          t.ticket_id,
          t.ticket_number,
          t.title AS ticket_title,
          t.category AS ticket_category,
          -- Asset details
          a.asset_tag,
          a.serial_number AS asset_serial,
          p.name AS asset_product_name,
          cat.name AS asset_category,
          -- Replacement asset (if any)
          ra.asset_tag AS replacement_asset_tag,
          rp.name AS replacement_product_name,
          -- User who raised ticket
          usr.first_name + ' ' + usr.last_name AS raised_by_name,
          usr.email AS raised_by_email,
          -- Assigned engineer
          eng.first_name + ' ' + eng.last_name AS engineer_name,
          eng.email AS engineer_email,
          -- Location
          loc.name AS location_name,
          loc.building AS location_building,
          -- Department
          dept.department_name,
          -- Parts count
          (SELECT COUNT(*) FROM SERVICE_REPORT_PARTS WHERE report_id = sr.report_id) AS parts_count,
          -- Total cost
          (sr.total_parts_cost + ISNULL(sr.labor_cost, 0)) AS total_cost
        FROM SERVICE_REPORTS sr
        INNER JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN assets ra ON sr.replacement_asset_id = ra.id
        LEFT JOIN products rp ON ra.product_id = rp.id
        LEFT JOIN USER_MASTER usr ON t.created_by_user_id = usr.user_id
        LEFT JOIN USER_MASTER eng ON t.assigned_to_engineer_id = eng.user_id
        LEFT JOIN locations loc ON t.location_id = loc.id
        LEFT JOIN DEPARTMENT_MASTER dept ON t.department_id = dept.department_id
        ${whereClause}
        ORDER BY sr.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      // Count query
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM SERVICE_REPORTS sr
        INNER JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER eng ON t.assigned_to_engineer_id = eng.user_id
        ${whereClause}
      `;

      // Build requests
      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      let countRequest = pool.request();

      // Add params to both requests
      Object.keys(params).forEach(key => {
        const uuidFields = ['engineerId', 'locationId', 'departmentId'];
        const dateFields = ['dateFrom', 'dateTo'];

        if (uuidFields.includes(key)) {
          request.input(key, sql.UniqueIdentifier, params[key]);
          countRequest.input(key, sql.UniqueIdentifier, params[key]);
        } else if (dateFields.includes(key)) {
          request.input(key, sql.DateTime, params[key]);
          countRequest.input(key, sql.DateTime, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
          countRequest.input(key, sql.VarChar, params[key]);
        }
      });

      const [reportsResult, countResult] = await Promise.all([
        request.query(query),
        countRequest.query(countQuery)
      ]);

      const total = countResult.recordset[0]?.total || 0;

      return {
        reports: reportsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching detailed service reports:', error);
      throw error;
    }
  }

  /**
   * Get service report with full details for PDF generation
   */
  static async getReportForPDF(reportId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          sr.*,
          -- Ticket details
          t.ticket_number,
          t.title AS ticket_title,
          t.description AS ticket_description,
          t.category AS ticket_category,
          t.priority AS ticket_priority,
          t.created_at AS ticket_created_at,
          t.closed_at AS ticket_closed_at,
          -- Asset details
          a.asset_tag,
          a.serial_number AS asset_serial,
          p.name AS asset_product_name,
          p.model AS asset_model,
          o.name AS asset_oem,
          cat.name AS asset_category,
          -- Replacement asset
          ra.asset_tag AS replacement_asset_tag,
          ra.serial_number AS replacement_serial,
          rp.name AS replacement_product_name,
          -- User who raised ticket
          usr.first_name + ' ' + usr.last_name AS raised_by_name,
          usr.email AS raised_by_email,
          usr.employee_id AS raised_by_emp_id,
          -- Assigned engineer
          eng.first_name + ' ' + eng.last_name AS engineer_name,
          eng.email AS engineer_email,
          -- Location
          loc.name AS location_name,
          loc.address AS location_address,
          loc.building AS location_building,
          loc.floor AS location_floor,
          -- Department
          dept.department_name,
          -- Report creator
          creator.first_name + ' ' + creator.last_name AS created_by_name
        FROM SERVICE_REPORTS sr
        INNER JOIN TICKETS t ON sr.ticket_id = t.ticket_id
        LEFT JOIN assets a ON sr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN assets ra ON sr.replacement_asset_id = ra.id
        LEFT JOIN products rp ON ra.product_id = rp.id
        LEFT JOIN USER_MASTER usr ON t.created_by_user_id = usr.user_id
        LEFT JOIN USER_MASTER eng ON t.assigned_to_engineer_id = eng.user_id
        LEFT JOIN USER_MASTER creator ON sr.created_by = creator.user_id
        LEFT JOIN locations loc ON t.location_id = loc.id
        LEFT JOIN DEPARTMENT_MASTER dept ON t.department_id = dept.department_id
        WHERE sr.report_id = @reportId
      `;

      const result = await pool.request()
        .input('reportId', sql.UniqueIdentifier, reportId)
        .query(query);

      const report = result.recordset[0];

      if (report) {
        // Get parts used with full details
        const partsQuery = `
          SELECT
            srp.quantity,
            srp.unit_cost,
            (srp.quantity * srp.unit_cost) AS total_cost,
            srp.notes AS part_notes,
            a.asset_tag,
            a.serial_number,
            p.name AS product_name,
            p.model AS product_model,
            c.name AS category_name,
            o.name AS oem_name
          FROM SERVICE_REPORT_PARTS srp
          INNER JOIN assets a ON srp.asset_id = a.id
          INNER JOIN products p ON a.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN oems o ON p.oem_id = o.id
          WHERE srp.report_id = @reportId
          ORDER BY p.name
        `;

        const partsResult = await pool.request()
          .input('reportId', sql.UniqueIdentifier, reportId)
          .query(partsQuery);

        report.parts_used = partsResult.recordset;
      }

      return report || null;
    } catch (error) {
      console.error('Error fetching report for PDF:', error);
      throw error;
    }
  }

  /**
   * Get multiple service reports for bulk PDF generation
   */
  static async getReportsForBulkPDF(reportIds) {
    try {
      const reports = [];
      for (const reportId of reportIds) {
        const report = await this.getReportForPDF(reportId);
        if (report) {
          reports.push(report);
        }
      }
      return reports;
    } catch (error) {
      console.error('Error fetching reports for bulk PDF:', error);
      throw error;
    }
  }

  /**
   * Get available spare parts (component assets with status='available')
   */
  static async getAvailableSpareParts(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = "WHERE a.asset_type = 'component' AND a.status = 'available' AND a.is_active = 1";
      const params = {};

      if (filters.category_id) {
        whereClause += ' AND p.category_id = @categoryId';
        params.categoryId = filters.category_id;
      }

      if (filters.location_id) {
        // Get location from assigned user or default location
        whereClause += ' AND (u.location_id = @locationId OR a.assigned_to IS NULL)';
        params.locationId = filters.location_id;
      }

      if (filters.search) {
        whereClause += ` AND (
          a.asset_tag LIKE @search
          OR a.serial_number LIKE @search
          OR p.name LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      const query = `
        SELECT
          a.id AS asset_id,
          a.asset_tag,
          a.serial_number,
          a.condition_status,
          a.purchase_cost,
          p.name AS product_name,
          c.name AS category_name
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
        ${whereClause}
        ORDER BY c.name, p.name, a.asset_tag
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        if (key === 'categoryId' || key === 'locationId') {
          request.input(key, sql.UniqueIdentifier, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching available spare parts:', error);
      throw error;
    }
  }

  /**
   * Get available replacement assets (standalone/parent assets with status='available')
   * For replacement service - finds assets that can replace another asset
   */
  static async getAvailableReplacementAssets(filters = {}) {
    try {
      const pool = await connectDB();

      // Get standalone or parent assets that are available (not assigned)
      let whereClause = "WHERE a.asset_type IN ('standalone', 'parent') AND a.status = 'available' AND a.is_active = 1";
      const params = {};

      // Filter by category to match the asset being replaced
      if (filters.category_id) {
        whereClause += ' AND p.category_id = @categoryId';
        params.categoryId = filters.category_id;
      }

      // Filter by product to get same type of asset
      if (filters.product_id) {
        whereClause += ' AND a.product_id = @productId';
        params.productId = filters.product_id;
      }

      if (filters.search) {
        whereClause += ` AND (
          a.asset_tag LIKE @search
          OR a.serial_number LIKE @search
          OR p.name LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      const query = `
        SELECT
          a.id AS asset_id,
          a.asset_tag,
          a.serial_number,
          a.condition_status,
          a.purchase_cost,
          a.asset_type,
          p.name AS product_name,
          p.model AS product_model,
          c.name AS category_name,
          o.name AS oem_name
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN oems o ON p.oem_id = o.id
        ${whereClause}
        ORDER BY c.name, p.name, a.asset_tag
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        if (key === 'categoryId' || key === 'productId') {
          request.input(key, sql.UniqueIdentifier, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching available replacement assets:', error);
      throw error;
    }
  }
}

module.exports = ServiceReportModel;
