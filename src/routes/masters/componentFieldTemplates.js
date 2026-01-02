const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { getPool } = require('../../config/database');
const validators = require('../../utils/validators');
const { authenticateToken } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/permissions');

// ============================================================================
// GET /masters/component-field-templates
// Get all component field templates (optional: filter by product_type_id)
// ============================================================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { product_type_id } = req.query;

    let query = `
      SELECT
        t.id as field_id,
        t.product_type_id,
        t.field_name,
        t.display_label,
        t.field_type,
        t.is_required,
        t.display_order,
        t.placeholder_text,
        t.help_text,
        t.min_value,
        t.max_value,
        t.is_active,
        t.created_at,
        t.updated_at,
        pt.name as product_type_name,
        o.id as option_id,
        o.option_value,
        o.option_label,
        o.is_default,
        o.display_order as option_order
      FROM component_field_templates t
      LEFT JOIN product_types pt ON t.product_type_id = pt.id
      LEFT JOIN component_field_options o ON t.id = o.field_template_id
      WHERE t.is_active = 1
    `;

    if (product_type_id) {
      query += ` AND t.product_type_id = @productTypeId`;
    }

    query += ` ORDER BY pt.name, t.display_order, o.display_order`;

    const request = pool.request();
    if (product_type_id) {
      request.input('productTypeId', sql.UniqueIdentifier, product_type_id);
    }

    const result = await request.query(query);

    // Group results by field
    const fieldsMap = new Map();

    result.recordset.forEach(row => {
      const fieldId = row.field_id;

      if (!fieldsMap.has(fieldId)) {
        fieldsMap.set(fieldId, {
          id: row.field_id,
          product_type_id: row.product_type_id,
          product_type_name: row.product_type_name,
          field_name: row.field_name,
          display_label: row.display_label,
          field_type: row.field_type,
          is_required: row.is_required,
          display_order: row.display_order,
          placeholder_text: row.placeholder_text,
          help_text: row.help_text,
          min_value: row.min_value,
          max_value: row.max_value,
          is_active: row.is_active,
          created_at: row.created_at,
          updated_at: row.updated_at,
          options: []
        });
      }

      if (row.option_id) {
        fieldsMap.get(fieldId).options.push({
          id: row.option_id,
          option_value: row.option_value,
          option_label: row.option_label,
          is_default: row.is_default,
          display_order: row.option_order
        });
      }
    });

    const fields = Array.from(fieldsMap.values());

    res.json({
      success: true,
      data: fields,
      count: fields.length
    });

  } catch (error) {
    console.error('Error fetching component field templates:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching component field templates',
      error: error.message
    });
  }
});

// ============================================================================
// GET /masters/component-field-templates/product-type/:productTypeId
// Get field templates for a specific product type (for form rendering)
// ============================================================================
router.get('/product-type/:productTypeId', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { productTypeId } = req.params;

    const result = await pool.request()
      .input('productTypeId', sql.UniqueIdentifier, productTypeId)
      .query(`
        SELECT
          t.id as field_id,
          t.product_type_id,
          t.field_name,
          t.display_label,
          t.field_type,
          t.is_required,
          t.display_order,
          t.placeholder_text,
          t.help_text,
          t.min_value,
          t.max_value,
          o.id as option_id,
          o.option_value,
          o.option_label,
          o.is_default,
          o.display_order as option_order
        FROM component_field_templates t
        LEFT JOIN component_field_options o ON t.id = o.field_template_id
        WHERE t.product_type_id = @productTypeId AND t.is_active = 1
        ORDER BY t.display_order, o.display_order
      `);

    // Group results by field
    const fieldsMap = new Map();

    result.recordset.forEach(row => {
      const fieldId = row.field_id;

      if (!fieldsMap.has(fieldId)) {
        fieldsMap.set(fieldId, {
          id: row.field_id,
          field_name: row.field_name,
          display_label: row.display_label,
          field_type: row.field_type,
          is_required: row.is_required,
          display_order: row.display_order,
          placeholder_text: row.placeholder_text,
          help_text: row.help_text,
          min_value: row.min_value,
          max_value: row.max_value,
          options: []
        });
      }

      if (row.option_id) {
        fieldsMap.get(fieldId).options.push({
          id: row.option_id,
          value: row.option_value,
          label: row.option_label,
          is_default: row.is_default,
          display_order: row.option_order
        });
      }
    });

    const fields = Array.from(fieldsMap.values());

    res.json({
      success: true,
      data: fields
    });

  } catch (error) {
    console.error('Error fetching field templates for product type:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching field templates',
      error: error.message
    });
  }
});

// ============================================================================
// POST /masters/component-field-templates
// Create a new field template (SuperAdmin only)
// ============================================================================
router.post('/', authenticateToken, requirePermission('manage_field_templates'), async (req, res) => {
  try {
    const { error, value } = validators.componentFieldTemplate.create.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const pool = getPool();
    const {
      product_type_id,
      field_name,
      display_label,
      field_type,
      is_required,
      display_order,
      placeholder_text,
      help_text,
      min_value,
      max_value
    } = value;

    const result = await pool.request()
      .input('productTypeId', sql.UniqueIdentifier, product_type_id)
      .input('fieldName', sql.VarChar(50), field_name)
      .input('displayLabel', sql.VarChar(100), display_label)
      .input('fieldType', sql.VarChar(20), field_type)
      .input('isRequired', sql.Bit, is_required)
      .input('displayOrder', sql.Int, display_order)
      .input('placeholderText', sql.VarChar(100), placeholder_text || null)
      .input('helpText', sql.VarChar(200), help_text || null)
      .input('minValue', sql.Decimal(10, 2), min_value || null)
      .input('maxValue', sql.Decimal(10, 2), max_value || null)
      .query(`
        INSERT INTO component_field_templates (
          product_type_id, field_name, display_label, field_type,
          is_required, display_order, placeholder_text, help_text,
          min_value, max_value
        )
        OUTPUT INSERTED.*
        VALUES (
          @productTypeId, @fieldName, @displayLabel, @fieldType,
          @isRequired, @displayOrder, @placeholderText, @helpText,
          @minValue, @maxValue
        )
      `);

    res.status(201).json({
      success: true,
      message: 'Field template created successfully',
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Error creating field template:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating field template',
      error: error.message
    });
  }
});

// ============================================================================
// PUT /masters/component-field-templates/:id
// Update a field template (SuperAdmin only)
// ============================================================================
router.put('/:id', authenticateToken, requirePermission('manage_field_templates'), async (req, res) => {
  try {
    const { error, value } = validators.componentFieldTemplate.update.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const pool = getPool();
    const { id } = req.params;

    // Build dynamic update query
    const updates = [];
    const request = pool.request();
    request.input('id', sql.UniqueIdentifier, id);

    if (value.product_type_id !== undefined) {
      updates.push('product_type_id = @productTypeId');
      request.input('productTypeId', sql.UniqueIdentifier, value.product_type_id);
    }
    if (value.field_name !== undefined) {
      updates.push('field_name = @fieldName');
      request.input('fieldName', sql.VarChar(50), value.field_name);
    }
    if (value.display_label !== undefined) {
      updates.push('display_label = @displayLabel');
      request.input('displayLabel', sql.VarChar(100), value.display_label);
    }
    if (value.field_type !== undefined) {
      updates.push('field_type = @fieldType');
      request.input('fieldType', sql.VarChar(20), value.field_type);
    }
    if (value.is_required !== undefined) {
      updates.push('is_required = @isRequired');
      request.input('isRequired', sql.Bit, value.is_required);
    }
    if (value.display_order !== undefined) {
      updates.push('display_order = @displayOrder');
      request.input('displayOrder', sql.Int, value.display_order);
    }
    if (value.placeholder_text !== undefined) {
      updates.push('placeholder_text = @placeholderText');
      request.input('placeholderText', sql.VarChar(100), value.placeholder_text || null);
    }
    if (value.help_text !== undefined) {
      updates.push('help_text = @helpText');
      request.input('helpText', sql.VarChar(200), value.help_text || null);
    }
    if (value.min_value !== undefined) {
      updates.push('min_value = @minValue');
      request.input('minValue', sql.Decimal(10, 2), value.min_value || null);
    }
    if (value.max_value !== undefined) {
      updates.push('max_value = @maxValue');
      request.input('maxValue', sql.Decimal(10, 2), value.max_value || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updates.push('updated_at = GETUTCDATE()');

    const result = await request.query(`
      UPDATE component_field_templates
      SET ${updates.join(', ')}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Field template not found'
      });
    }

    res.json({
      success: true,
      message: 'Field template updated successfully',
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Error updating field template:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating field template',
      error: error.message
    });
  }
});

// ============================================================================
// DELETE /masters/component-field-templates/:id
// Soft delete a field template (SuperAdmin only)
// ============================================================================
router.delete('/:id', authenticateToken, requirePermission('manage_field_templates'), async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE component_field_templates
        SET is_active = 0, updated_at = GETUTCDATE()
        OUTPUT INSERTED.*
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Field template not found'
      });
    }

    res.json({
      success: true,
      message: 'Field template deleted successfully',
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Error deleting field template:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting field template',
      error: error.message
    });
  }
});

// ============================================================================
// POST /masters/component-field-templates/:id/options
// Create a new field option (SuperAdmin only)
// ============================================================================
router.post('/:id/options', authenticateToken, requirePermission('manage_field_templates'), async (req, res) => {
  try {
    const { error, value } = validators.componentFieldOption.create.validate({
      ...req.body,
      field_template_id: req.params.id
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const pool = getPool();
    const {
      field_template_id,
      option_value,
      option_label,
      is_default,
      display_order
    } = value;

    const result = await pool.request()
      .input('fieldTemplateId', sql.UniqueIdentifier, field_template_id)
      .input('optionValue', sql.VarChar(50), option_value)
      .input('optionLabel', sql.VarChar(100), option_label)
      .input('isDefault', sql.Bit, is_default)
      .input('displayOrder', sql.Int, display_order)
      .query(`
        INSERT INTO component_field_options (
          field_template_id, option_value, option_label, is_default, display_order
        )
        OUTPUT INSERTED.*
        VALUES (
          @fieldTemplateId, @optionValue, @optionLabel, @isDefault, @displayOrder
        )
      `);

    res.status(201).json({
      success: true,
      message: 'Field option created successfully',
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Error creating field option:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating field option',
      error: error.message
    });
  }
});

// ============================================================================
// PUT /masters/component-field-templates/options/:optionId
// Update a field option (SuperAdmin only)
// ============================================================================
router.put('/options/:optionId', authenticateToken, requirePermission('manage_field_templates'), async (req, res) => {
  try {
    const { error, value } = validators.componentFieldOption.update.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const pool = getPool();
    const { optionId } = req.params;

    // Build dynamic update query
    const updates = [];
    const request = pool.request();
    request.input('id', sql.UniqueIdentifier, optionId);

    if (value.option_value !== undefined) {
      updates.push('option_value = @optionValue');
      request.input('optionValue', sql.VarChar(50), value.option_value);
    }
    if (value.option_label !== undefined) {
      updates.push('option_label = @optionLabel');
      request.input('optionLabel', sql.VarChar(100), value.option_label);
    }
    if (value.is_default !== undefined) {
      updates.push('is_default = @isDefault');
      request.input('isDefault', sql.Bit, value.is_default);
    }
    if (value.display_order !== undefined) {
      updates.push('display_order = @displayOrder');
      request.input('displayOrder', sql.Int, value.display_order);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updates.push('updated_at = GETUTCDATE()');

    const result = await request.query(`
      UPDATE component_field_options
      SET ${updates.join(', ')}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Field option not found'
      });
    }

    res.json({
      success: true,
      message: 'Field option updated successfully',
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Error updating field option:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating field option',
      error: error.message
    });
  }
});

// ============================================================================
// DELETE /masters/component-field-templates/options/:optionId
// Delete a field option (SuperAdmin only)
// ============================================================================
router.delete('/options/:optionId', authenticateToken, requirePermission('manage_field_templates'), async (req, res) => {
  try {
    const pool = getPool();
    const { optionId } = req.params;

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, optionId)
      .query(`
        DELETE FROM component_field_options
        OUTPUT DELETED.*
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Field option not found'
      });
    }

    res.json({
      success: true,
      message: 'Field option deleted successfully',
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Error deleting field option:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting field option',
      error: error.message
    });
  }
});

module.exports = router;
