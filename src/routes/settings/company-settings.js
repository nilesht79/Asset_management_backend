/**
 * Company Settings Route
 * Manage company branding settings (logo, name, address) for PDF reports
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { connectDB, sql } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError } = require('../../utils/response');
const { uploadLogo, handleUploadError } = require('../../middleware/upload');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /settings/company
 * Get company settings (logo, name, address)
 */
router.get('/',
  requireRole(['admin', 'superadmin']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request()
      .query(`
        SELECT config_key, config_value
        FROM system_config
        WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS')
      `);

    const settings = {
      logo: null,
      logoUrl: null,
      name: 'Asset Management System',
      address: ''
    };

    result.recordset.forEach(row => {
      if (row.config_key === 'COMPANY_LOGO') {
        settings.logo = row.config_value || null;
        if (row.config_value && row.config_value.trim() !== '') {
          settings.logoUrl = `/settings/company/logo/${row.config_value}`;
        }
      } else if (row.config_key === 'COMPANY_NAME') {
        settings.name = row.config_value || 'Asset Management System';
      } else if (row.config_key === 'COMPANY_ADDRESS') {
        settings.address = row.config_value || '';
      }
    });

    sendSuccess(res, settings, 'Company settings retrieved successfully');
  })
);

/**
 * PUT /settings/company
 * Update company settings (name, address)
 */
router.put('/',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const { name, address } = req.body;

    const pool = await connectDB();

    // Update or insert company name
    if (name !== undefined) {
      await pool.request()
        .input('key', sql.VarChar(100), 'COMPANY_NAME')
        .input('value', sql.VarChar(500), name)
        .query(`
          IF EXISTS (SELECT 1 FROM system_config WHERE config_key = @key)
            UPDATE system_config SET config_value = @value, updated_at = GETUTCDATE() WHERE config_key = @key
          ELSE
            INSERT INTO system_config (config_key, config_value, description, category, is_editable)
            VALUES (@key, @value, 'Company name for PDF reports', 'branding', 1)
        `);
    }

    // Update or insert company address
    if (address !== undefined) {
      await pool.request()
        .input('key', sql.VarChar(100), 'COMPANY_ADDRESS')
        .input('value', sql.VarChar(500), address)
        .query(`
          IF EXISTS (SELECT 1 FROM system_config WHERE config_key = @key)
            UPDATE system_config SET config_value = @value, updated_at = GETUTCDATE() WHERE config_key = @key
          ELSE
            INSERT INTO system_config (config_key, config_value, description, category, is_editable)
            VALUES (@key, @value, 'Company address for PDF reports', 'branding', 1)
        `);
    }

    // Fetch updated settings
    const result = await pool.request()
      .query(`
        SELECT config_key, config_value
        FROM system_config
        WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS')
      `);

    const settings = {
      logo: null,
      logoUrl: null,
      name: 'Asset Management System',
      address: ''
    };

    result.recordset.forEach(row => {
      if (row.config_key === 'COMPANY_LOGO') {
        settings.logo = row.config_value || null;
        if (row.config_value && row.config_value.trim() !== '') {
          settings.logoUrl = `/settings/company/logo/${row.config_value}`;
        }
      } else if (row.config_key === 'COMPANY_NAME') {
        settings.name = row.config_value || 'Asset Management System';
      } else if (row.config_key === 'COMPANY_ADDRESS') {
        settings.address = row.config_value || '';
      }
    });

    sendSuccess(res, settings, 'Company settings updated successfully');
  })
);

/**
 * POST /settings/company/logo
 * Upload company logo (resized to max 400x400)
 */
router.post('/logo',
  requireRole(['superadmin']),
  uploadLogo.single('logo'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No logo file uploaded', 400);
    }

    const pool = await connectDB();

    // Get old logo filename to delete
    const oldLogo = await pool.request()
      .input('key', sql.VarChar(100), 'COMPANY_LOGO')
      .query('SELECT config_value FROM system_config WHERE config_key = @key');

    // Delete old logo file if exists
    if (oldLogo.recordset.length > 0 && oldLogo.recordset[0].config_value) {
      const oldLogoPath = path.join(__dirname, '../../../uploads/logos/', oldLogo.recordset[0].config_value);
      if (fs.existsSync(oldLogoPath)) {
        fs.unlinkSync(oldLogoPath);
      }
    }

    // Resize the uploaded logo
    const uploadedPath = req.file.path;
    const resizedFilename = 'logo-' + Date.now() + '.png';
    const resizedPath = path.join(__dirname, '../../../uploads/logos/', resizedFilename);

    try {
      await sharp(uploadedPath)
        .resize(400, 400, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png({ quality: 90 })
        .toFile(resizedPath);

      // Delete the original uploaded file
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
    } catch (resizeError) {
      console.error('Failed to resize logo:', resizeError);
      // If resize fails, use the original file
      fs.renameSync(uploadedPath, resizedPath);
    }

    // Save resized logo filename to database
    await pool.request()
      .input('key', sql.VarChar(100), 'COMPANY_LOGO')
      .input('value', sql.VarChar(500), resizedFilename)
      .query(`
        IF EXISTS (SELECT 1 FROM system_config WHERE config_key = @key)
          UPDATE system_config SET config_value = @value, updated_at = GETUTCDATE() WHERE config_key = @key
        ELSE
          INSERT INTO system_config (config_key, config_value, description, category, is_editable)
          VALUES (@key, @value, 'Company logo filename for PDF reports', 'branding', 1)
      `);

    sendSuccess(res, {
      logo: resizedFilename,
      logoUrl: `/settings/company/logo/${resizedFilename}`
    }, 'Company logo uploaded successfully');
  })
);

/**
 * DELETE /settings/company/logo
 * Delete company logo
 */
router.delete('/logo',
  requireRole(['superadmin']),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    // Get logo filename
    const result = await pool.request()
      .input('key', sql.VarChar(100), 'COMPANY_LOGO')
      .query('SELECT config_value FROM system_config WHERE config_key = @key');

    if (result.recordset.length > 0 && result.recordset[0].config_value) {
      // Delete file
      const logoPath = path.join(__dirname, '../../../uploads/logos/', result.recordset[0].config_value);
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
      }

      // Clear database value (use empty string since NULL not allowed)
      await pool.request()
        .input('key', sql.VarChar(100), 'COMPANY_LOGO')
        .query("UPDATE system_config SET config_value = '', updated_at = GETUTCDATE() WHERE config_key = @key");
    }

    sendSuccess(res, null, 'Company logo deleted successfully');
  })
);

/**
 * GET /settings/company/logo/:filename
 * Serve company logo file
 */
router.get('/logo/:filename',
  asyncHandler(async (req, res) => {
    const { filename } = req.params;

    // Sanitize filename to prevent directory traversal
    const sanitizedFilename = path.basename(filename);
    const logoPath = path.join(__dirname, '../../../uploads/logos/', sanitizedFilename);

    if (!fs.existsSync(logoPath)) {
      return sendError(res, 'Logo not found', 404);
    }

    res.sendFile(logoPath);
  })
);

module.exports = router;
