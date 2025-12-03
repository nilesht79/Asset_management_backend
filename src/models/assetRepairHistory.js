/**
 * ASSET REPAIR HISTORY MODEL
 * Handles all database operations for asset repair tracking
 */

const { connectDB, sql } = require('../config/database');

class AssetRepairHistoryModel {
  /**
   * Create a new repair history entry
   */
  static async createRepairEntry(repairData) {
    try {
      const pool = await connectDB();

      // Use table variable to capture OUTPUT when triggers are present
      const query = `
        DECLARE @InsertedRepair TABLE (repair_id UNIQUEIDENTIFIER);
        DECLARE @NewRepairId UNIQUEIDENTIFIER = NEWID();

        INSERT INTO ASSET_REPAIR_HISTORY (
          repair_id,
          asset_id,
          parent_asset_id,
          ticket_id,
          fault_type_id,
          fault_description,
          repair_date,
          engineer_id,
          parts_replaced,
          labor_hours,
          parts_cost,
          labor_cost,
          resolution,
          repair_status,
          is_external_repair,
          vendor_id,
          vendor_reference,
          notes,
          warranty_claim,
          warranty_claim_reference,
          created_by,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.repair_id INTO @InsertedRepair
        VALUES (
          @NewRepairId,
          @assetId,
          @parentAssetId,
          @ticketId,
          @faultTypeId,
          @faultDescription,
          @repairDate,
          @engineerId,
          @partsReplaced,
          @laborHours,
          @partsCost,
          @laborCost,
          @resolution,
          @repairStatus,
          @isExternalRepair,
          @vendorId,
          @vendorReference,
          @notes,
          @warrantyClaim,
          @warrantyClaimReference,
          @createdBy,
          GETDATE(),
          GETDATE()
        );

        SELECT * FROM ASSET_REPAIR_HISTORY WHERE repair_id = @NewRepairId;
      `;

      const result = await pool.request()
        .input('assetId', sql.UniqueIdentifier, repairData.asset_id)
        .input('parentAssetId', sql.UniqueIdentifier, repairData.parent_asset_id || null)
        .input('ticketId', sql.UniqueIdentifier, repairData.ticket_id || null)
        .input('faultTypeId', sql.UniqueIdentifier, repairData.fault_type_id || null)
        .input('faultDescription', sql.NVarChar(sql.MAX), repairData.fault_description)
        .input('repairDate', sql.DateTime, repairData.repair_date || new Date())
        .input('engineerId', sql.UniqueIdentifier, repairData.engineer_id || null)
        .input('partsReplaced', sql.NVarChar(sql.MAX), repairData.parts_replaced || null)
        .input('laborHours', sql.Decimal(5, 2), repairData.labor_hours || null)
        .input('partsCost', sql.Decimal(12, 2), repairData.parts_cost || 0)
        .input('laborCost', sql.Decimal(12, 2), repairData.labor_cost || 0)
        .input('resolution', sql.NVarChar(sql.MAX), repairData.resolution || null)
        .input('repairStatus', sql.VarChar(20), repairData.repair_status || 'completed')
        .input('isExternalRepair', sql.Bit, repairData.is_external_repair || false)
        .input('vendorId', sql.UniqueIdentifier, repairData.vendor_id || null)
        .input('vendorReference', sql.NVarChar(100), repairData.vendor_reference || null)
        .input('notes', sql.NVarChar(sql.MAX), repairData.notes || null)
        .input('warrantyClaim', sql.Bit, repairData.warranty_claim || false)
        .input('warrantyClaimReference', sql.NVarChar(100), repairData.warranty_claim_reference || null)
        .input('createdBy', sql.UniqueIdentifier, repairData.created_by)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating repair entry:', error);
      throw error;
    }
  }

  /**
   * Get repair history for an asset
   */
  static async getAssetRepairHistory(assetId, options = {}) {
    try {
      const pool = await connectDB();
      const { page = 1, limit = 20 } = options;
      const offset = (page - 1) * limit;

      const query = `
        SELECT
          rh.*,
          -- Fault type
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          -- Ticket info
          t.ticket_number,
          t.title AS ticket_title,
          -- Engineer
          u.first_name + ' ' + u.last_name AS engineer_name,
          u.email AS engineer_email,
          -- Vendor
          v.name AS vendor_name,
          -- Created by
          cu.first_name + ' ' + cu.last_name AS created_by_name,
          -- Repaired asset info
          ra.asset_tag AS component_asset_tag,
          ra.asset_type AS repaired_asset_type,
          rp.name AS component_product_name,
          -- Parent asset info (from repair record OR from asset's parent)
          COALESCE(pa.asset_tag, ra_parent.asset_tag) AS parent_asset_tag,
          COALESCE(pp.name, ra_parent_p.name) AS parent_product_name,
          -- Flag if this is a component repair (check repair record OR asset type)
          CASE
            WHEN rh.parent_asset_id IS NOT NULL THEN 1
            WHEN ra.asset_type = 'component' THEN 1
            ELSE 0
          END AS is_component_repair
        FROM ASSET_REPAIR_HISTORY rh
        LEFT JOIN FAULT_TYPES ft ON rh.fault_type_id = ft.fault_type_id
        LEFT JOIN TICKETS t ON rh.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u ON rh.engineer_id = u.user_id
        LEFT JOIN vendors v ON rh.vendor_id = v.id
        LEFT JOIN USER_MASTER cu ON rh.created_by = cu.user_id
        -- Repaired asset info
        LEFT JOIN assets ra ON rh.asset_id = ra.id
        LEFT JOIN products rp ON ra.product_id = rp.id
        -- Parent from repair record
        LEFT JOIN assets pa ON rh.parent_asset_id = pa.id
        LEFT JOIN products pp ON pa.product_id = pp.id
        -- Parent from asset's parent_asset_id (fallback)
        LEFT JOIN assets ra_parent ON ra.parent_asset_id = ra_parent.id
        LEFT JOIN products ra_parent_p ON ra_parent.product_id = ra_parent_p.id
        WHERE rh.asset_id = @assetId
           OR rh.parent_asset_id = @assetId
           OR ra.parent_asset_id = @assetId
        ORDER BY rh.repair_date DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total
        FROM ASSET_REPAIR_HISTORY rh
        LEFT JOIN assets ra ON rh.asset_id = ra.id
        WHERE rh.asset_id = @assetId
           OR rh.parent_asset_id = @assetId
           OR ra.parent_asset_id = @assetId
      `;

      const [historyResult, countResult] = await Promise.all([
        pool.request()
          .input('assetId', sql.UniqueIdentifier, assetId)
          .input('offset', sql.Int, offset)
          .input('limit', sql.Int, limit)
          .query(query),
        pool.request()
          .input('assetId', sql.UniqueIdentifier, assetId)
          .query(countQuery)
      ]);

      return {
        repairs: historyResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching asset repair history:', error);
      throw error;
    }
  }

  /**
   * Get repair entry by ID
   */
  static async getRepairById(repairId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          rh.*,
          -- Asset info
          a.asset_tag,
          a.serial_number,
          p.name AS product_name,
          p.model AS product_model,
          o.name AS oem_name,
          -- Fault type
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          -- Ticket info
          t.ticket_number,
          t.title AS ticket_title,
          t.status AS ticket_status,
          -- Engineer
          u.first_name + ' ' + u.last_name AS engineer_name,
          u.email AS engineer_email,
          -- Vendor
          v.name AS vendor_name,
          -- Created by
          cu.first_name + ' ' + cu.last_name AS created_by_name,
          -- Parent asset info (if component repair)
          pa.asset_tag AS parent_asset_tag,
          pa.serial_number AS parent_serial_number,
          pp.name AS parent_product_name,
          pp.model AS parent_product_model,
          -- Flag if this is a component repair
          CASE WHEN rh.parent_asset_id IS NOT NULL THEN 1 ELSE 0 END AS is_component_repair
        FROM ASSET_REPAIR_HISTORY rh
        INNER JOIN assets a ON rh.asset_id = a.id
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN FAULT_TYPES ft ON rh.fault_type_id = ft.fault_type_id
        LEFT JOIN TICKETS t ON rh.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u ON rh.engineer_id = u.user_id
        LEFT JOIN vendors v ON rh.vendor_id = v.id
        LEFT JOIN USER_MASTER cu ON rh.created_by = cu.user_id
        LEFT JOIN assets pa ON rh.parent_asset_id = pa.id
        LEFT JOIN products pp ON pa.product_id = pp.id
        WHERE rh.repair_id = @repairId
      `;

      const result = await pool.request()
        .input('repairId', sql.UniqueIdentifier, repairId)
        .query(query);

      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching repair by ID:', error);
      throw error;
    }
  }

  /**
   * Update repair entry
   */
  static async updateRepairEntry(repairId, updateData) {
    try {
      const pool = await connectDB();

      const allowedFields = [
        'parent_asset_id', 'fault_type_id', 'fault_description', 'repair_date', 'engineer_id',
        'parts_replaced', 'labor_hours', 'parts_cost', 'labor_cost',
        'resolution', 'repair_status', 'is_external_repair', 'vendor_id',
        'vendor_reference', 'notes', 'warranty_claim', 'warranty_claim_reference'
      ];

      const updates = [];
      const params = { repairId };

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
        UPDATE ASSET_REPAIR_HISTORY
        SET ${updates.join(', ')}, updated_at = GETDATE()
        WHERE repair_id = @repairId
      `;

      let request = pool.request();
      request.input('repairId', sql.UniqueIdentifier, repairId);

      Object.keys(params).forEach(key => {
        if (key !== 'repairId') {
          if (key.endsWith('_id')) {
            request.input(key, sql.UniqueIdentifier, params[key]);
          } else if (key === 'parts_cost' || key === 'labor_cost') {
            request.input(key, sql.Decimal(12, 2), params[key]);
          } else if (key === 'labor_hours') {
            request.input(key, sql.Decimal(5, 2), params[key]);
          } else if (key === 'repair_date') {
            request.input(key, sql.DateTime, params[key]);
          } else if (key === 'is_external_repair' || key === 'warranty_claim') {
            request.input(key, sql.Bit, params[key]);
          } else if (key === 'repair_status' || key === 'vendor_reference' || key === 'warranty_claim_reference') {
            request.input(key, sql.VarChar, params[key]);
          } else {
            request.input(key, sql.NVarChar(sql.MAX), params[key]);
          }
        }
      });

      await request.query(query);
      return await this.getRepairById(repairId);
    } catch (error) {
      console.error('Error updating repair entry:', error);
      throw error;
    }
  }

  /**
   * Delete repair entry
   */
  static async deleteRepairEntry(repairId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('repairId', sql.UniqueIdentifier, repairId)
        .query(`DELETE FROM ASSET_REPAIR_HISTORY WHERE repair_id = @repairId`);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting repair entry:', error);
      throw error;
    }
  }

  /**
   * Get repair statistics for an asset
   */
  static async getAssetRepairStats(assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('assetId', sql.UniqueIdentifier, assetId)
        .execute('sp_GetAssetRepairSummary');

      return {
        summary: result.recordsets[0][0] || null,
        faultBreakdown: result.recordsets[1] || []
      };
    } catch (error) {
      console.error('Error fetching asset repair stats:', error);
      throw error;
    }
  }

  /**
   * Create repair entries from ticket closure
   * Called when a ticket with linked assets is closed
   */
  static async createFromTicketClosure(ticketId, closureData, createdBy) {
    try {
      const pool = await connectDB();

      // Get ticket info and linked assets
      const ticketQuery = `
        SELECT
          t.ticket_id,
          t.title,
          t.description,
          t.resolution_notes,
          t.assigned_to_engineer_id,
          t.category,
          ta.asset_id
        FROM TICKETS t
        INNER JOIN TICKET_ASSETS ta ON t.ticket_id = ta.ticket_id
        WHERE t.ticket_id = @ticketId
      `;

      const ticketResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(ticketQuery);

      if (ticketResult.recordset.length === 0) {
        return [];
      }

      const repairs = [];
      const ticket = ticketResult.recordset[0];

      // Create repair entry for each linked asset
      for (const row of ticketResult.recordset) {
        const repairEntry = await this.createRepairEntry({
          asset_id: row.asset_id,
          ticket_id: ticketId,
          fault_type_id: closureData.fault_type_id || null,
          fault_description: closureData.fault_description || ticket.description || ticket.title,
          repair_date: new Date(),
          engineer_id: ticket.assigned_to_engineer_id,
          parts_replaced: closureData.parts_replaced || null,
          labor_hours: closureData.labor_hours || null,
          parts_cost: closureData.parts_cost || 0,
          labor_cost: closureData.labor_cost || 0,
          resolution: closureData.resolution || ticket.resolution_notes,
          repair_status: 'completed',
          is_external_repair: closureData.is_external_repair || false,
          vendor_id: closureData.vendor_id || null,
          warranty_claim: closureData.warranty_claim || false,
          notes: closureData.notes || null,
          created_by: createdBy
        });

        repairs.push(repairEntry);
      }

      return repairs;
    } catch (error) {
      console.error('Error creating repairs from ticket closure:', error);
      throw error;
    }
  }

  /**
   * Get all repairs (with filters)
   */
  static async getAllRepairs(filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();
      const { page = 1, limit = 20 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.asset_id) {
        whereClause += ' AND rh.asset_id = @assetId';
        params.assetId = filters.asset_id;
      }

      if (filters.fault_type_id) {
        whereClause += ' AND rh.fault_type_id = @faultTypeId';
        params.faultTypeId = filters.fault_type_id;
      }

      if (filters.engineer_id) {
        whereClause += ' AND rh.engineer_id = @engineerId';
        params.engineerId = filters.engineer_id;
      }

      if (filters.repair_status) {
        whereClause += ' AND rh.repair_status = @repairStatus';
        params.repairStatus = filters.repair_status;
      }

      if (filters.date_from) {
        whereClause += ' AND rh.repair_date >= @dateFrom';
        params.dateFrom = filters.date_from;
      }

      if (filters.date_to) {
        whereClause += ' AND rh.repair_date <= @dateTo';
        params.dateTo = filters.date_to;
      }

      if (filters.warranty_claim !== undefined) {
        whereClause += ' AND rh.warranty_claim = @warrantyClaim';
        params.warrantyClaim = filters.warranty_claim;
      }

      const query = `
        SELECT
          rh.*,
          a.asset_tag,
          a.serial_number,
          p.name AS product_name,
          p.model AS product_model,
          ft.name AS fault_type_name,
          ft.category AS fault_category,
          t.ticket_number,
          u.first_name + ' ' + u.last_name AS engineer_name
        FROM ASSET_REPAIR_HISTORY rh
        INNER JOIN assets a ON rh.asset_id = a.id
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN FAULT_TYPES ft ON rh.fault_type_id = ft.fault_type_id
        LEFT JOIN TICKETS t ON rh.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u ON rh.engineer_id = u.user_id
        ${whereClause}
        ORDER BY rh.repair_date DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const countQuery = `
        SELECT COUNT(*) AS total
        FROM ASSET_REPAIR_HISTORY rh
        ${whereClause}
      `;

      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      let countRequest = pool.request();

      Object.keys(params).forEach(key => {
        if (key.endsWith('Id')) {
          request.input(key, sql.UniqueIdentifier, params[key]);
          countRequest.input(key, sql.UniqueIdentifier, params[key]);
        } else if (key.startsWith('date')) {
          request.input(key, sql.DateTime, params[key]);
          countRequest.input(key, sql.DateTime, params[key]);
        } else if (key === 'warrantyClaim') {
          request.input(key, sql.Bit, params[key]);
          countRequest.input(key, sql.Bit, params[key]);
        } else {
          request.input(key, sql.VarChar, params[key]);
          countRequest.input(key, sql.VarChar, params[key]);
        }
      });

      const [repairsResult, countResult] = await Promise.all([
        request.query(query),
        countRequest.query(countQuery)
      ]);

      return {
        repairs: repairsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0].total,
          pages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching all repairs:', error);
      throw error;
    }
  }

  /**
   * Get repair cost summary
   */
  static async getRepairCostSummary(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.date_from) {
        whereClause += ' AND repair_date >= @dateFrom';
        params.dateFrom = filters.date_from;
      }

      if (filters.date_to) {
        whereClause += ' AND repair_date <= @dateTo';
        params.dateTo = filters.date_to;
      }

      const query = `
        SELECT
          COUNT(*) AS total_repairs,
          SUM(ISNULL(parts_cost, 0)) AS total_parts_cost,
          SUM(ISNULL(labor_cost, 0)) AS total_labor_cost,
          SUM(ISNULL(total_cost, 0)) AS total_cost,
          AVG(ISNULL(total_cost, 0)) AS avg_repair_cost,
          SUM(CASE WHEN warranty_claim = 1 THEN 1 ELSE 0 END) AS warranty_claims,
          SUM(CASE WHEN is_external_repair = 1 THEN 1 ELSE 0 END) AS external_repairs
        FROM ASSET_REPAIR_HISTORY
        ${whereClause}
      `;

      let request = pool.request();

      Object.keys(params).forEach(key => {
        request.input(key, sql.DateTime, params[key]);
      });

      const result = await request.query(query);
      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching repair cost summary:', error);
      throw error;
    }
  }
}

module.exports = AssetRepairHistoryModel;
