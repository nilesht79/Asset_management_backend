const express = require('express');
const router = express.Router();
const sql = require('mssql');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('../config/database');
const { asyncHandler } = require('../middleware/error-handler');
const { requireDynamicPermission } = require('../middleware/permissions');
const { authenticateToken } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const { uploadSignature, uploadSignedForm, handleUploadError } = require('../middleware/upload');
const htmlPdf = require('html-pdf-node');

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/v1/delivery-tickets - Get all delivery tickets
router.get(
  '/',
  requireDynamicPermission(),
  validatePagination,
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { page = 1, limit = 10, search, status, delivery_type, assigned_engineer } = req.query;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';

    if (search) {
      whereClause += ` AND (
        dt.ticket_number LIKE @search OR
        a.asset_tag LIKE @search OR
        CONCAT(u.first_name, ' ', u.last_name) LIKE @search
      )`;
    }

    if (status) {
      whereClause += ` AND dt.status = @status`;
    }

    if (delivery_type) {
      whereClause += ` AND dt.delivery_type = @delivery_type`;
    }

    // Filter by assigned engineer (for engineer's "My Deliveries" view)
    // Note: Engineer is stored in 'delivered_by' column
    if (assigned_engineer === 'me') {
      whereClause += ` AND dt.delivered_by = @engineer_id`;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ASSET_DELIVERY_TICKETS dt
      LEFT JOIN assets a ON dt.asset_id = a.id
      LEFT JOIN USER_MASTER u ON dt.user_id = u.user_id
      ${whereClause}
    `;

    const countRequest = pool.request();
    if (search) countRequest.input('search', sql.VarChar, `%${search}%`);
    if (status) countRequest.input('status', sql.VarChar, status);
    if (delivery_type) countRequest.input('delivery_type', sql.VarChar, delivery_type);
    if (assigned_engineer === 'me') countRequest.input('engineer_id', sql.UniqueIdentifier, req.user.id);

    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].total;

    // Get delivery tickets
    // Note: Using a.asset_tag instead of dt.asset_tag to get current value from assets table
    const query = `
      SELECT
        dt.ticket_id,
        dt.ticket_number,
        dt.requisition_id,
        dt.asset_id,
        a.asset_tag,
        dt.user_id,
        dt.user_name,
        dt.delivery_type,
        dt.scheduled_delivery_date,
        dt.actual_delivery_date,
        dt.delivery_location_id,
        dt.delivery_location_name,
        dt.status,
        dt.delivered_by,
        dt.delivered_by_name,
        dt.physical_form_generated,
        dt.physical_form_path,
        dt.physical_form_signed,
        dt.physical_form_signed_at,
        dt.recipient_signature_path,
        dt.recipient_signature_ip,
        dt.recipient_confirmed_at,
        dt.coordinator_signature_path,
        dt.coordinator_confirmed_at,
        dt.delivery_notes,
        dt.recipient_comments,
        dt.created_at,
        dt.updated_at,
        dt.created_by,
        dt.signed_form_upload_path,
        dt.signed_form_uploaded_by,
        dt.signed_form_uploaded_at,
        dt.coordinator_verified,
        dt.coordinator_verified_by,
        dt.coordinator_verified_at,
        dt.coordinator_verification_notes,
        dt.functionality_confirmed,
        dt.functionality_confirmed_at,
        dt.functionality_notes,
        r.requisition_number,
        CONCAT(u.first_name, ' ', u.last_name) as recipient_name,
        u.email as recipient_email,
        d.department_name as department_name,
        dt.delivered_by_name as assigned_engineer_name
      FROM ASSET_DELIVERY_TICKETS dt
      LEFT JOIN assets a ON dt.asset_id = a.id
      LEFT JOIN ASSET_REQUISITIONS r ON dt.requisition_id = r.requisition_id
      LEFT JOIN USER_MASTER u ON dt.user_id = u.user_id
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      ${whereClause}
      ORDER BY dt.created_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const request = pool.request();
    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, parseInt(limit));
    if (search) request.input('search', sql.VarChar, `%${search}%`);
    if (status) request.input('status', sql.VarChar, status);
    if (delivery_type) request.input('delivery_type', sql.VarChar, delivery_type);
    if (assigned_engineer === 'me') request.input('engineer_id', sql.UniqueIdentifier, req.user.id);

    const result = await request.query(query);

    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  })
);

// PUT /api/v1/delivery-tickets/:id/schedule - Schedule delivery
router.put(
  '/:id/schedule',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const { scheduled_delivery_date, notes } = req.body;

    if (!scheduled_delivery_date) {
      return res.status(400).json({
        success: false,
        message: 'Scheduled delivery date is required'
      });
    }

    await pool.request()
      .input('ticket_id', sql.UniqueIdentifier, id)
      .input('scheduled_delivery_date', sql.DateTime, scheduled_delivery_date)
      .input('status', sql.VarChar, 'scheduled')
      .query(`
        UPDATE ASSET_DELIVERY_TICKETS
        SET
          scheduled_delivery_date = @scheduled_delivery_date,
          status = @status
        WHERE ticket_id = @ticket_id
      `);

    res.json({
      success: true,
      message: 'Delivery scheduled successfully'
    });
  })
);

// PUT /api/v1/delivery-tickets/:id/dispatch - Dispatch for delivery
router.put(
  '/:id/dispatch',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;

    await pool.request()
      .input('ticket_id', sql.UniqueIdentifier, id)
      .input('status', sql.VarChar, 'in_transit')
      .query(`
        UPDATE ASSET_DELIVERY_TICKETS
        SET status = @status
        WHERE ticket_id = @ticket_id
      `);

    res.json({
      success: true,
      message: 'Delivery dispatched successfully'
    });
  })
);

// PUT /api/v1/delivery-tickets/:id/mark-delivered - Mark as delivered
router.put(
  '/:id/mark-delivered',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const { actual_delivery_date, notes } = req.body;

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Update delivery ticket
      await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .input('status', sql.VarChar, 'delivered')
        .input('actual_delivery_date', sql.DateTime, actual_delivery_date || new Date())
        .query(`
          UPDATE ASSET_DELIVERY_TICKETS
          SET
            status = @status,
            actual_delivery_date = @actual_delivery_date
          WHERE ticket_id = @ticket_id
        `);

      // Get requisition ID
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT requisition_id FROM ASSET_DELIVERY_TICKETS
          WHERE ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length > 0) {
        const requisitionId = ticketResult.recordset[0].requisition_id;

        // Update requisition status to delivered
        await transaction.request()
          .input('requisition_id', sql.UniqueIdentifier, requisitionId)
          .input('status', sql.VarChar, 'delivered')
          .query(`
            UPDATE ASSET_REQUISITIONS
            SET
              status = @status,
              updated_at = GETUTCDATE()
            WHERE requisition_id = @requisition_id
          `);
      }

      await transaction.commit();

      res.json({
        success: true,
        message: 'Delivery marked as delivered successfully'
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// PUT /api/v1/delivery-tickets/:id/mark-failed - Mark delivery as failed
router.put(
  '/:id/mark-failed',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const { failure_reason } = req.body;

    if (!failure_reason) {
      return res.status(400).json({
        success: false,
        message: 'Failure reason is required'
      });
    }

    await pool.request()
      .input('ticket_id', sql.UniqueIdentifier, id)
      .input('status', sql.VarChar, 'failed')
      .query(`
        UPDATE ASSET_DELIVERY_TICKETS
        SET status = @status
        WHERE ticket_id = @ticket_id
      `);

    res.json({
      success: true,
      message: 'Delivery marked as failed'
    });
  })
);

// POST /api/v1/delivery-tickets/:id/generate-form - Generate delivery form (PDF)
router.post(
  '/:id/generate-form',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;

    // Get delivery ticket details including employee signature
    const result = await pool.request()
      .input('ticket_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          dt.*,
          a.asset_tag,
          a.serial_number,
          r.requisition_number,
          r.purpose,
          r.employee_signature_path,
          r.employee_confirmed_at,
          CONCAT(u.first_name, ' ', u.last_name) as recipient_name,
          u.email as recipient_email,
          d.department_name as department_name,
          p.name as product_name,
          p.model as product_model,
          c.name as category_name
        FROM ASSET_DELIVERY_TICKETS dt
        LEFT JOIN assets a ON dt.asset_id = a.id
        LEFT JOIN ASSET_REQUISITIONS r ON dt.requisition_id = r.requisition_id
        LEFT JOIN USER_MASTER u ON dt.user_id = u.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE dt.ticket_id = @ticket_id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Delivery ticket not found'
      });
    }

    const ticket = result.recordset[0];

    // Convert employee signature to base64 if it exists
    let employeeSignatureBase64 = '';
    if (ticket.employee_signature_path) {
      try {
        const signaturePath = path.join(__dirname, '../..', ticket.employee_signature_path);
        if (fs.existsSync(signaturePath)) {
          const imageBuffer = fs.readFileSync(signaturePath);
          employeeSignatureBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        }
      } catch (error) {
        console.error('Error reading employee signature:', error);
      }
    }

    // Generate simple HTML form (in production, use a proper PDF library like pdfkit or puppeteer)
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .section { margin-bottom: 20px; }
          .field { margin-bottom: 10px; }
          .label { font-weight: bold; display: inline-block; width: 200px; }
          .signature-box { border: 1px solid #000; height: 80px; margin-top: 10px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Asset Delivery Form</h1>
          <p>Delivery Ticket: <strong>${ticket.ticket_number}</strong></p>
          <p>Date: ${new Date().toLocaleDateString()}</p>
        </div>

        <div class="section">
          <h3>Recipient Information</h3>
          <div class="field"><span class="label">Name:</span> ${ticket.recipient_name}</div>
          <div class="field"><span class="label">Email:</span> ${ticket.recipient_email}</div>
          <div class="field"><span class="label">Department:</span> ${ticket.department_name}</div>
        </div>

        <div class="section">
          <h3>Asset Information</h3>
          <table>
            <tr><th>Field</th><th>Details</th></tr>
            <tr><td>Asset Tag</td><td>${ticket.asset_tag}</td></tr>
            <tr><td>Serial Number</td><td>${ticket.serial_number || 'N/A'}</td></tr>
            <tr><td>Category</td><td>${ticket.category_name || 'N/A'}</td></tr>
            <tr><td>Product</td><td>${ticket.product_name || 'N/A'} ${ticket.product_model ? '- ' + ticket.product_model : ''}</td></tr>
            <tr><td>Requisition</td><td>${ticket.requisition_number}</td></tr>
          </table>
        </div>

        <div class="section">
          <h3>Delivery Details</h3>
          <div class="field"><span class="label">Delivery Type:</span> ${ticket.delivery_type}</div>
          <div class="field"><span class="label">Scheduled Date:</span> ${ticket.scheduled_delivery_date ? new Date(ticket.scheduled_delivery_date).toLocaleString() : 'Not scheduled'}</div>
        </div>

        <div class="section">
          <h3>Purpose</h3>
          <p>${ticket.purpose || 'N/A'}</p>
        </div>

        <div class="section">
          <h3>Recipient Acknowledgment</h3>
          <p>I acknowledge receipt of the above asset in good working condition and agree to use it responsibly according to company policies.</p>
          <div class="field" style="margin-top: 40px;">
            <span class="label">Recipient Signature:</span>
            ${employeeSignatureBase64 ?
              `<div style="margin-top: 10px;">
                <img src="${employeeSignatureBase64}"
                     alt="Employee Signature"
                     style="max-width: 300px; max-height: 100px; border: 1px solid #ddd; padding: 5px;" />
              </div>` :
              '<div class="signature-box"></div>'
            }
          </div>
          <div class="field">
            <span class="label">Date:</span> ${ticket.employee_confirmed_at ? new Date(ticket.employee_confirmed_at).toLocaleDateString() : '_______________________'}
          </div>
        </div>
      </body>
      </html>
    `;

    // Update ticket to mark form as generated
    await pool.request()
      .input('ticket_id', sql.UniqueIdentifier, id)
      .query(`
        UPDATE ASSET_DELIVERY_TICKETS
        SET physical_form_generated = 1
        WHERE ticket_id = @ticket_id
      `);

    // Generate PDF from HTML
    const file = { content: htmlContent };
    const options = {
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
    };

    try {
      const pdfBuffer = await htmlPdf.generatePdf(file, options);

      // Return PDF as response
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=Delivery_Form_${ticket.ticket_number}.pdf`);
      res.send(pdfBuffer);
    } catch (pdfError) {
      console.error('PDF generation error:', pdfError);
      throw new Error('Failed to generate PDF');
    }
  })
);

// POST /api/v1/delivery-tickets/:id/confirm-by-employee - Employee confirms delivery
// No permission required - employees can confirm their own deliveries (authorization checked below)
router.post(
  '/:id/confirm-by-employee',
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const userId = req.oauth.user.id;
    const { signature_data } = req.body;

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get ticket and requisition details
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT
            dt.*,
            r.requested_by
          FROM ASSET_DELIVERY_TICKETS dt
          LEFT JOIN ASSET_REQUISITIONS r ON dt.requisition_id = r.requisition_id
          WHERE dt.ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Delivery ticket not found'
        });
      }

      const ticket = ticketResult.recordset[0];

      // Verify requisition exists
      if (!ticket.requisition_id) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Delivery ticket is not associated with a requisition'
        });
      }

      // Verify user is the recipient
      if (ticket.user_id !== userId && ticket.requested_by !== userId) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to confirm this delivery'
        });
      }

      // Save signature as a file if provided
      let signatureFilePath = null;
      if (signature_data) {
        try {
          // Extract base64 data from data URL (format: data:image/png;base64,xxxxx)
          const base64Data = signature_data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');

          // Create uploads directory if it doesn't exist
          const uploadsDir = path.join(__dirname, '../../uploads/delivery-signatures');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }

          // Generate unique filename
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const filename = `employee-signature-${uniqueSuffix}.png`;
          const filePath = path.join(uploadsDir, filename);

          // Write file to disk
          fs.writeFileSync(filePath, buffer);

          // Store relative path for database
          signatureFilePath = `/uploads/delivery-signatures/${filename}`;
        } catch (fileError) {
          console.error('Error saving signature file:', fileError);
          await transaction.rollback();
          return res.status(500).json({
            success: false,
            message: 'Failed to save signature file'
          });
        }
      }

      // Update requisition with employee confirmation
      // Status: 'pending_verification' - awaiting coordinator's final functionality check
      await transaction.request()
        .input('requisition_id', sql.UniqueIdentifier, ticket.requisition_id)
        .input('confirmed_by_employee', sql.Bit, 1)
        .input('employee_signature_path', sql.VarChar, signatureFilePath)
        .input('employee_confirmed_at', sql.DateTime, new Date())
        .input('status', sql.VarChar, 'pending_verification')
        .query(`
          UPDATE ASSET_REQUISITIONS
          SET
            confirmed_by_employee = @confirmed_by_employee,
            employee_signature_path = @employee_signature_path,
            employee_confirmed_at = @employee_confirmed_at,
            status = @status,
            updated_at = GETUTCDATE()
          WHERE requisition_id = @requisition_id
        `);

      // Update delivery ticket signature and status
      await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .input('recipient_signature_path', sql.VarChar, signatureFilePath)
        .input('status', sql.VarChar, 'pending_verification')
        .query(`
          UPDATE ASSET_DELIVERY_TICKETS
          SET
            recipient_signature_path = @recipient_signature_path,
            status = @status,
            updated_at = GETUTCDATE()
          WHERE ticket_id = @ticket_id
        `);

      await transaction.commit();

      res.json({
        success: true,
        message: 'Delivery confirmed successfully',
        signature_path: signatureFilePath
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// POST /api/v1/delivery-tickets/:id/upload-signature-online - Employee uploads digital signature
router.post(
  '/:id/upload-signature-online',
  requireDynamicPermission(),
  uploadSignature.single('signature'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No signature file uploaded'
      });
    }

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get ticket details and verify employee is the recipient
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT dt.*, r.requested_by
          FROM ASSET_DELIVERY_TICKETS dt
          LEFT JOIN ASSET_REQUISITIONS r ON dt.requisition_id = r.requisition_id
          WHERE dt.ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Delivery ticket not found'
        });
      }

      const ticket = ticketResult.recordset[0];

      if (ticket.requested_by !== userId) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to sign this delivery'
        });
      }

      // Update delivery ticket with signature
      const signaturePath = `/uploads/delivery-signatures/${req.file.filename}`;

      await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .input('recipient_signature_path', sql.VarChar, signaturePath)
        .input('recipient_confirmed_at', sql.DateTime, new Date())
        .input('status', sql.VarChar, 'pending_verification')
        .query(`
          UPDATE ASSET_DELIVERY_TICKETS
          SET
            recipient_signature_path = @recipient_signature_path,
            recipient_confirmed_at = @recipient_confirmed_at,
            status = @status,
            updated_at = GETUTCDATE()
          WHERE ticket_id = @ticket_id
        `);

      await transaction.commit();

      res.json({
        success: true,
        message: 'Signature uploaded successfully. Awaiting coordinator verification.',
        data: {
          signature_path: signaturePath
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// POST /api/v1/delivery-tickets/:id/upload-signed-form - Engineer uploads offline signed form
router.post(
  '/:id/upload-signed-form',
  requireDynamicPermission(),
  uploadSignedForm.single('signed_form'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No signed form file uploaded'
      });
    }

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get ticket details and verify engineer is assigned
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT * FROM ASSET_DELIVERY_TICKETS
          WHERE ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Delivery ticket not found'
        });
      }

      const ticket = ticketResult.recordset[0];

      if (ticket.delivered_by !== userId) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to upload form for this delivery'
        });
      }

      // Update delivery ticket with signed form
      const signedFormPath = `/uploads/signed-forms/${req.file.filename}`;

      await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .input('signed_form_upload_path', sql.VarChar, signedFormPath)
        .input('signed_form_uploaded_by', sql.UniqueIdentifier, userId)
        .input('signed_form_uploaded_at', sql.DateTime, new Date())
        .input('physical_form_signed', sql.Bit, 1)
        .input('physical_form_signed_at', sql.DateTime, new Date())
        .input('status', sql.VarChar, 'pending_verification')
        .query(`
          UPDATE ASSET_DELIVERY_TICKETS
          SET
            signed_form_upload_path = @signed_form_upload_path,
            signed_form_uploaded_by = @signed_form_uploaded_by,
            signed_form_uploaded_at = @signed_form_uploaded_at,
            physical_form_signed = @physical_form_signed,
            physical_form_signed_at = @physical_form_signed_at,
            status = @status,
            updated_at = GETUTCDATE()
          WHERE ticket_id = @ticket_id
        `);

      await transaction.commit();

      res.json({
        success: true,
        message: 'Signed form uploaded successfully. Awaiting coordinator verification.',
        data: {
          signed_form_path: signedFormPath
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// PUT /api/v1/delivery-tickets/:id/verify-signature - Coordinator verifies signature/form
router.put(
  '/:id/verify-signature',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const { verification_notes, approved } = req.body;
    const userId = req.user.id;
    const userName = `${req.user.firstName} ${req.user.lastName}`;

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get ticket and asset details
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT dt.*, r.requested_by, r.requisition_id
          FROM ASSET_DELIVERY_TICKETS dt
          LEFT JOIN ASSET_REQUISITIONS r ON dt.requisition_id = r.requisition_id
          WHERE dt.ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Delivery ticket not found'
        });
      }

      const ticket = ticketResult.recordset[0];

      if (approved) {
        // Update delivery ticket as verified
        await transaction.request()
          .input('ticket_id', sql.UniqueIdentifier, id)
          .input('coordinator_verified', sql.Bit, 1)
          .input('coordinator_verified_by', sql.UniqueIdentifier, userId)
          .input('coordinator_verified_at', sql.DateTime, new Date())
          .input('coordinator_verification_notes', sql.Text, verification_notes)
          .input('status', sql.VarChar, 'pending_confirmation')
          .query(`
            UPDATE ASSET_DELIVERY_TICKETS
            SET
              coordinator_verified = @coordinator_verified,
              coordinator_verified_by = @coordinator_verified_by,
              coordinator_verified_at = @coordinator_verified_at,
              coordinator_verification_notes = @coordinator_verification_notes,
              status = @status,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticket_id
          `);

        // Update asset status from 'in_transit' to 'assigned' and assign to employee
        await transaction.request()
          .input('asset_id', sql.UniqueIdentifier, ticket.asset_id)
          .input('user_id', sql.UniqueIdentifier, ticket.requested_by)
          .input('status', sql.VarChar, 'assigned')
          .query(`
            UPDATE assets
            SET
              assigned_to = @user_id,
              status = @status,
              updated_at = GETUTCDATE()
            WHERE id = @asset_id
          `);

        await transaction.commit();

        res.json({
          success: true,
          message: 'Signature verified successfully. Asset assigned to employee. Awaiting functionality confirmation.'
        });
      } else {
        // Verification rejected
        await transaction.request()
          .input('ticket_id', sql.UniqueIdentifier, id)
          .input('coordinator_verification_notes', sql.Text, verification_notes || 'Verification rejected')
          .input('status', sql.VarChar, 'failed')
          .query(`
            UPDATE ASSET_DELIVERY_TICKETS
            SET
              coordinator_verification_notes = @coordinator_verification_notes,
              status = @status,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticket_id
          `);

        // Return asset to available
        await transaction.request()
          .input('asset_id', sql.UniqueIdentifier, ticket.asset_id)
          .input('status', sql.VarChar, 'available')
          .query(`
            UPDATE assets
            SET
              assigned_to = NULL,
              status = @status,
              updated_at = GETUTCDATE()
            WHERE id = @asset_id
          `);

        await transaction.commit();

        res.json({
          success: true,
          message: 'Verification rejected. Asset returned to available pool.'
        });
      }
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// PUT /api/v1/delivery-tickets/:id/confirm-functionality - Coordinator confirms functionality
router.put(
  '/:id/confirm-functionality',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const { functionality_notes, confirmed } = req.body;

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get ticket details
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT dt.*
          FROM ASSET_DELIVERY_TICKETS dt
          WHERE dt.ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Delivery ticket not found'
        });
      }

      const ticket = ticketResult.recordset[0];

      if (confirmed) {
        // Update delivery ticket as functionality confirmed
        await transaction.request()
          .input('ticket_id', sql.UniqueIdentifier, id)
          .input('functionality_confirmed', sql.Bit, 1)
          .input('functionality_confirmed_at', sql.DateTime, new Date())
          .input('functionality_notes', sql.Text, functionality_notes)
          .input('status', sql.VarChar, 'delivered')
          .input('actual_delivery_date', sql.DateTime, new Date())
          .query(`
            UPDATE ASSET_DELIVERY_TICKETS
            SET
              functionality_confirmed = @functionality_confirmed,
              functionality_confirmed_at = @functionality_confirmed_at,
              functionality_notes = @functionality_notes,
              status = @status,
              actual_delivery_date = @actual_delivery_date,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticket_id
          `);

        // Update requisition to completed
        await transaction.request()
          .input('requisition_id', sql.UniqueIdentifier, ticket.requisition_id)
          .input('status', sql.VarChar, 'completed')
          .input('completed_at', sql.DateTime, new Date())
          .query(`
            UPDATE ASSET_REQUISITIONS
            SET
              status = @status,
              completed_at = @completed_at,
              updated_at = GETUTCDATE()
            WHERE requisition_id = @requisition_id
          `);

        // Update asset status to 'assigned' (final confirmation - asset is now with employee)
        await transaction.request()
          .input('asset_id', sql.UniqueIdentifier, ticket.asset_id)
          .input('user_id', sql.UniqueIdentifier, ticket.user_id)
          .input('status', sql.VarChar, 'assigned')
          .query(`
            UPDATE ASSETS
            SET
              status = @status,
              assigned_to = @user_id,
              updated_at = GETUTCDATE()
            WHERE id = @asset_id
          `);

        await transaction.commit();

        res.json({
          success: true,
          message: 'Functionality confirmed. Delivery completed successfully.'
        });
      } else {
        // Functionality issues reported
        await transaction.request()
          .input('ticket_id', sql.UniqueIdentifier, id)
          .input('functionality_notes', sql.Text, functionality_notes || 'Functionality issues reported')
          .input('status', sql.VarChar, 'failed')
          .query(`
            UPDATE ASSET_DELIVERY_TICKETS
            SET
              functionality_notes = @functionality_notes,
              status = @status,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticket_id
          `);

        await transaction.commit();

        res.json({
          success: true,
          message: 'Functionality issues reported. Delivery marked as failed.'
        });
      }
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// PUT /api/v1/delivery-tickets/:id/mark-delivered - Coordinator directly marks as delivered (bypass verification)
router.put(
  '/:id/mark-delivered',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const { id } = req.params;
    const { notes } = req.body;

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get ticket details
      const ticketResult = await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .query(`
          SELECT dt.*
          FROM ASSET_DELIVERY_TICKETS dt
          WHERE dt.ticket_id = @ticket_id
        `);

      if (ticketResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Delivery ticket not found'
        });
      }

      const ticket = ticketResult.recordset[0];

      // Validate requisition_id exists
      if (!ticket.requisition_id) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Requisition ID not found for this delivery ticket'
        });
      }

      // Get employee ID from requisition
      const requisitionResult = await transaction.request()
        .input('requisition_id', sql.UniqueIdentifier, ticket.requisition_id)
        .query(`
          SELECT user_id, requester_name
          FROM ASSET_REQUISITIONS
          WHERE requisition_id = @requisition_id
        `);

      if (requisitionResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }

      const requisition = requisitionResult.recordset[0];
      const employeeId = requisition.user_id;

      // Assign asset to employee
      await transaction.request()
        .input('asset_id', sql.UniqueIdentifier, ticket.asset_id)
        .input('assigned_to', sql.UniqueIdentifier, employeeId)
        .input('status', sql.VarChar, 'assigned')
        .query(`
          UPDATE assets
          SET
            assigned_to = @assigned_to,
            status = @status,
            updated_at = GETUTCDATE()
          WHERE id = @asset_id
        `);

      // Mark delivery ticket as delivered
      await transaction.request()
        .input('ticket_id', sql.UniqueIdentifier, id)
        .input('status', sql.VarChar, 'delivered')
        .input('actual_delivery_date', sql.DateTime, new Date())
        .input('coordinator_verified', sql.Bit, 1)
        .input('coordinator_verified_by', sql.UniqueIdentifier, req.user.id)
        .input('coordinator_verified_at', sql.DateTime, new Date())
        .input('coordinator_verification_notes', sql.Text, notes || 'Directly marked as delivered by coordinator')
        .input('functionality_confirmed', sql.Bit, 1)
        .input('functionality_confirmed_at', sql.DateTime, new Date())
        .input('functionality_notes', sql.Text, notes || 'Confirmed by coordinator')
        .query(`
          UPDATE ASSET_DELIVERY_TICKETS
          SET
            status = @status,
            actual_delivery_date = @actual_delivery_date,
            coordinator_verified = @coordinator_verified,
            coordinator_verified_by = @coordinator_verified_by,
            coordinator_verified_at = @coordinator_verified_at,
            coordinator_verification_notes = @coordinator_verification_notes,
            functionality_confirmed = @functionality_confirmed,
            functionality_confirmed_at = @functionality_confirmed_at,
            functionality_notes = @functionality_notes,
            updated_at = GETUTCDATE()
          WHERE ticket_id = @ticket_id
        `);

      // Mark requisition as completed
      await transaction.request()
        .input('requisition_id', sql.UniqueIdentifier, ticket.requisition_id)
        .input('status', sql.VarChar, 'completed')
        .input('completed_at', sql.DateTime, new Date())
        .query(`
          UPDATE ASSET_REQUISITIONS
          SET
            status = @status,
            completed_at = @completed_at,
            updated_at = GETUTCDATE()
          WHERE requisition_id = @requisition_id
        `);

      await transaction.commit();

      res.json({
        success: true,
        message: 'Delivery marked as completed. Asset assigned to employee and requisition completed.'
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

module.exports = router;
