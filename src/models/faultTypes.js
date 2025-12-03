/**
 * FAULT TYPES MODEL
 * Handles fault type lookup operations
 */

const { connectDB, sql } = require('../config/database');

class FaultTypesModel {
  /**
   * Get all fault types
   */
  static async getAllFaultTypes(includeInactive = false) {
    try {
      const pool = await connectDB();

      let query = `
        SELECT
          fault_type_id,
          name,
          category,
          description,
          is_active,
          created_at,
          updated_at
        FROM FAULT_TYPES
      `;

      if (!includeInactive) {
        query += ' WHERE is_active = 1';
      }

      query += ' ORDER BY category, name';

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching fault types:', error);
      throw error;
    }
  }

  /**
   * Get fault types grouped by category
   */
  static async getFaultTypesByCategory() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          fault_type_id,
          name,
          category,
          description
        FROM FAULT_TYPES
        WHERE is_active = 1
        ORDER BY category, name
      `;

      const result = await pool.request().query(query);

      // Group by category
      const grouped = {};
      result.recordset.forEach(ft => {
        if (!grouped[ft.category]) {
          grouped[ft.category] = [];
        }
        grouped[ft.category].push(ft);
      });

      return grouped;
    } catch (error) {
      console.error('Error fetching fault types by category:', error);
      throw error;
    }
  }

  /**
   * Get fault type by ID
   */
  static async getFaultTypeById(faultTypeId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('faultTypeId', sql.UniqueIdentifier, faultTypeId)
        .query(`
          SELECT * FROM FAULT_TYPES WHERE fault_type_id = @faultTypeId
        `);

      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching fault type:', error);
      throw error;
    }
  }

  /**
   * Create a new fault type
   */
  static async createFaultType(data) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO FAULT_TYPES (
          fault_type_id, name, category, description, is_active, created_at, updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @name, @category, @description, 1, GETDATE(), GETDATE()
        )
      `;

      const result = await pool.request()
        .input('name', sql.VarChar(100), data.name)
        .input('category', sql.VarChar(50), data.category)
        .input('description', sql.NVarChar(500), data.description || null)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      if (error.number === 2627) {
        throw new Error('Fault type with this name already exists');
      }
      console.error('Error creating fault type:', error);
      throw error;
    }
  }

  /**
   * Update fault type
   */
  static async updateFaultType(faultTypeId, data) {
    try {
      const pool = await connectDB();

      const query = `
        UPDATE FAULT_TYPES
        SET
          name = COALESCE(@name, name),
          category = COALESCE(@category, category),
          description = COALESCE(@description, description),
          is_active = COALESCE(@isActive, is_active),
          updated_at = GETDATE()
        OUTPUT INSERTED.*
        WHERE fault_type_id = @faultTypeId
      `;

      const result = await pool.request()
        .input('faultTypeId', sql.UniqueIdentifier, faultTypeId)
        .input('name', sql.VarChar(100), data.name || null)
        .input('category', sql.VarChar(50), data.category || null)
        .input('description', sql.NVarChar(500), data.description || null)
        .input('isActive', sql.Bit, data.is_active !== undefined ? data.is_active : null)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error updating fault type:', error);
      throw error;
    }
  }

  /**
   * Delete fault type (soft delete by setting is_active = 0)
   */
  static async deleteFaultType(faultTypeId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('faultTypeId', sql.UniqueIdentifier, faultTypeId)
        .query(`
          UPDATE FAULT_TYPES
          SET is_active = 0, updated_at = GETDATE()
          WHERE fault_type_id = @faultTypeId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error deleting fault type:', error);
      throw error;
    }
  }

  /**
   * Get fault categories
   */
  static async getCategories() {
    try {
      const pool = await connectDB();

      const result = await pool.request().query(`
        SELECT DISTINCT category
        FROM FAULT_TYPES
        WHERE is_active = 1
        ORDER BY category
      `);

      return result.recordset.map(r => r.category);
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  }

  /**
   * Get fault type statistics
   */
  static async getFaultTypeStats() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          ft.fault_type_id,
          ft.name,
          ft.category,
          COUNT(rh.repair_id) AS usage_count,
          SUM(ISNULL(rh.total_cost, 0)) AS total_cost
        FROM FAULT_TYPES ft
        LEFT JOIN ASSET_REPAIR_HISTORY rh ON ft.fault_type_id = rh.fault_type_id
        WHERE ft.is_active = 1
        GROUP BY ft.fault_type_id, ft.name, ft.category
        ORDER BY usage_count DESC
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching fault type stats:', error);
      throw error;
    }
  }
}

module.exports = FaultTypesModel;
