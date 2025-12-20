/**
 * TICKET ASSETS MODEL
 * Handles linking assets to tickets
 */

const { connectDB, sql } = require('../config/database');

class TicketAssetsModel {
  /**
   * Link an asset to a ticket
   */
  static async linkAsset(ticketId, assetId, addedBy, notes = null) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO TICKET_ASSETS (
          id, ticket_id, asset_id, added_by, added_at, notes
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @ticketId, @assetId, @addedBy, GETDATE(), @notes
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .input('addedBy', sql.UniqueIdentifier, addedBy)
        .input('notes', sql.NVarChar(500), notes)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      // Handle duplicate link error
      if (error.number === 2627) {
        throw new Error('Asset is already linked to this ticket');
      }
      console.error('Error linking asset to ticket:', error);
      throw error;
    }
  }

  /**
   * Unlink an asset from a ticket
   */
  static async unlinkAsset(ticketId, assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(`
          DELETE FROM TICKET_ASSETS
          WHERE ticket_id = @ticketId AND asset_id = @assetId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error unlinking asset from ticket:', error);
      throw error;
    }
  }

  /**
   * Get all assets linked to a ticket (includes components of linked parent assets)
   */
  static async getTicketAssets(ticketId, includeComponents = true) {
    try {
      const pool = await connectDB();

      const query = `
        -- Get directly linked assets
        SELECT
          ta.id,
          ta.ticket_id,
          ta.asset_id,
          ta.added_by,
          ta.added_at,
          ta.notes,
          -- Asset details
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          a.status AS asset_status,
          a.condition_status,
          a.parent_asset_id,
          -- Product details
          p.name AS product_name,
          p.model AS product_model,
          -- OEM details
          o.name AS oem_name,
          -- Category
          c.name AS category_name,
          -- Parent asset info (if component)
          pa.asset_tag AS parent_asset_tag,
          -- Added by user
          u.first_name + ' ' + u.last_name AS added_by_name,
          -- Flag to indicate if directly linked
          1 AS is_directly_linked,
          0 AS is_component_of_linked
        FROM TICKET_ASSETS ta
        INNER JOIN assets a ON ta.asset_id = a.id
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN assets pa ON a.parent_asset_id = pa.id
        LEFT JOIN USER_MASTER u ON ta.added_by = u.user_id
        WHERE ta.ticket_id = @ticketId

        ${includeComponents ? `
        UNION ALL

        -- Get components of linked parent assets
        SELECT
          NULL AS id,
          @ticketId AS ticket_id,
          comp.id AS asset_id,
          NULL AS added_by,
          NULL AS added_at,
          NULL AS notes,
          -- Component asset details
          comp.asset_tag,
          comp.serial_number,
          comp.asset_type,
          comp.status AS asset_status,
          comp.condition_status,
          comp.parent_asset_id,
          -- Component product details
          cp.name AS product_name,
          cp.model AS product_model,
          -- OEM details
          co.name AS oem_name,
          -- Category
          cc.name AS category_name,
          -- Parent asset tag
          parent.asset_tag AS parent_asset_tag,
          -- Added by user (from parent's link)
          pu.first_name + ' ' + pu.last_name AS added_by_name,
          -- Flag to indicate this is a component of linked asset
          0 AS is_directly_linked,
          1 AS is_component_of_linked
        FROM TICKET_ASSETS ta
        INNER JOIN assets parent ON ta.asset_id = parent.id
        INNER JOIN assets comp ON comp.parent_asset_id = parent.id
        INNER JOIN products cp ON comp.product_id = cp.id
        LEFT JOIN oems co ON cp.oem_id = co.id
        LEFT JOIN categories cc ON cp.category_id = cc.id
        LEFT JOIN USER_MASTER pu ON ta.added_by = pu.user_id
        WHERE ta.ticket_id = @ticketId
          AND parent.asset_type = 'parent'
          AND comp.asset_type = 'component'
          AND comp.is_active = 1
          -- Exclude components that are already directly linked to this ticket
          AND NOT EXISTS (
            SELECT 1 FROM TICKET_ASSETS ta2
            WHERE ta2.ticket_id = @ticketId AND ta2.asset_id = comp.id
          )
        ` : ''}

        ORDER BY is_directly_linked DESC, parent_asset_tag, asset_tag
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching ticket assets:', error);
      throw error;
    }
  }

  /**
   * Get all tickets linked to an asset
   */
  static async getAssetTickets(assetId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          ta.id,
          ta.ticket_id,
          ta.asset_id,
          ta.added_at,
          ta.notes,
          -- Ticket details
          t.ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category,
          t.created_at AS ticket_created_at,
          t.closed_at,
          t.resolution_notes,
          -- Engineer
          u.first_name + ' ' + u.last_name AS engineer_name
        FROM TICKET_ASSETS ta
        INNER JOIN TICKETS t ON ta.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        WHERE ta.asset_id = @assetId
        ORDER BY t.created_at DESC
      `;

      const result = await pool.request()
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching asset tickets:', error);
      throw error;
    }
  }

  /**
   * Link multiple assets to a ticket
   */
  static async linkMultipleAssets(ticketId, assetIds, addedBy) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        const results = [];

        for (const assetId of assetIds) {
          const result = await transaction.request()
            .input('ticketId', sql.UniqueIdentifier, ticketId)
            .input('assetId', sql.UniqueIdentifier, assetId)
            .input('addedBy', sql.UniqueIdentifier, addedBy)
            .query(`
              IF NOT EXISTS (
                SELECT 1 FROM TICKET_ASSETS
                WHERE ticket_id = @ticketId AND asset_id = @assetId
              )
              BEGIN
                INSERT INTO TICKET_ASSETS (id, ticket_id, asset_id, added_by, added_at)
                OUTPUT INSERTED.*
                VALUES (NEWID(), @ticketId, @assetId, @addedBy, GETDATE())
              END
            `);

          if (result.recordset.length > 0) {
            results.push(result.recordset[0]);
          }
        }

        await transaction.commit();
        return results;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error linking multiple assets:', error);
      throw error;
    }
  }

  /**
   * Check if asset is linked to ticket
   */
  static async isAssetLinked(ticketId, assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(`
          SELECT COUNT(*) AS count
          FROM TICKET_ASSETS
          WHERE ticket_id = @ticketId AND asset_id = @assetId
        `);

      return result.recordset[0].count > 0;
    } catch (error) {
      console.error('Error checking asset link:', error);
      throw error;
    }
  }

  /**
   * Get employee's assigned assets (for ticket creation)
   * Includes standalone assets, parent assets, and their components
   */
  static async getEmployeeAssets(userId) {
    try {
      const pool = await connectDB();

      const query = `
        -- Get directly assigned assets (standalone and parent)
        SELECT
          a.id,
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          a.status,
          a.condition_status,
          a.parent_asset_id,
          NULL AS parent_asset_tag,
          p.name AS product_name,
          p.model AS product_model,
          o.name AS oem_name,
          c.name AS category_name,
          0 AS is_component_of_assigned
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE a.assigned_to = @userId
          AND a.is_active = 1
          AND a.status <> 'retired'
          AND a.asset_type IN ('standalone', 'parent')

        UNION ALL

        -- Get components of assigned parent assets
        SELECT
          comp.id,
          comp.asset_tag,
          comp.serial_number,
          comp.asset_type,
          comp.status,
          comp.condition_status,
          comp.parent_asset_id,
          parent.asset_tag AS parent_asset_tag,
          p.name AS product_name,
          p.model AS product_model,
          o.name AS oem_name,
          c.name AS category_name,
          1 AS is_component_of_assigned
        FROM assets comp
        INNER JOIN assets parent ON comp.parent_asset_id = parent.id
        INNER JOIN products p ON comp.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE parent.assigned_to = @userId
          AND comp.is_active = 1
          AND comp.status <> 'retired'
          AND parent.status <> 'retired'
          AND comp.asset_type = 'component'

        ORDER BY asset_type, product_name, asset_tag
      `;

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching employee assets:', error);
      throw error;
    }
  }

  /**
   * Get count of assets linked to a ticket
   */
  static async getTicketAssetCount(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT COUNT(*) AS count
          FROM TICKET_ASSETS
          WHERE ticket_id = @ticketId
        `);

      return result.recordset[0].count;
    } catch (error) {
      console.error('Error getting ticket asset count:', error);
      throw error;
    }
  }
}

module.exports = TicketAssetsModel;
