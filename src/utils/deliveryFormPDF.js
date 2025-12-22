/**
 * ASSET DELIVERY FORM PDF GENERATOR
 * Professional PDF documents for Asset Delivery Forms
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('../config/database');

class DeliveryFormPDF {
  // Colors
  static colors = {
    primary: '#1a365d',
    secondary: '#2b6cb0',
    success: '#38a169',
    warning: '#dd6b20',
    danger: '#e53e3e',
    gray: '#718096',
    lightGray: '#f7fafc',
    border: '#e2e8f0',
    white: '#ffffff',
    black: '#2d3748'
  };

  /**
   * Get company settings from database
   */
  static async getCompanySettings() {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .query(`
          SELECT config_key, config_value
          FROM system_config
          WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL', 'SHOW_COMPANY_NAME_IN_PDF')
        `);

      const settings = {};
      result.recordset.forEach(row => {
        settings[row.config_key] = row.config_value;
      });

      return {
        logo: settings.COMPANY_LOGO || null,
        name: settings.COMPANY_NAME || 'Unified ITSM Platform',
        address: settings.COMPANY_ADDRESS || '',
        phone: settings.COMPANY_PHONE || '',
        email: settings.COMPANY_EMAIL || '',
        showNameInPdf: settings.SHOW_COMPANY_NAME_IN_PDF === 'true' || settings.SHOW_COMPANY_NAME_IN_PDF === '1' || settings.SHOW_COMPANY_NAME_IN_PDF === undefined
      };
    } catch (error) {
      console.error('Error fetching company settings:', error);
      return { logo: null, name: 'Unified ITSM Platform', address: '', phone: '', email: '', showNameInPdf: true };
    }
  }

  /**
   * Generate Delivery Form PDF
   */
  static async generate(ticket, employeeSignaturePath = null) {
    const companySettings = await this.getCompanySettings();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 40,
          size: 'A4',
          autoFirstPage: true
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.renderDeliveryForm(doc, ticket, companySettings, employeeSignaturePath);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Render full delivery form
   */
  static renderDeliveryForm(doc, ticket, companySettings, employeeSignaturePath) {
    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;
    let y = margin;

    // ===== HEADER WITH COMPANY LOGO =====
    y = this.renderHeader(doc, companySettings, margin, y, pageWidth);

    // ===== TITLE =====
    y = this.renderTitle(doc, ticket, margin, y, pageWidth);

    // ===== RECIPIENT INFORMATION =====
    y = this.renderRecipientInfo(doc, ticket, margin, y, pageWidth);

    // ===== ASSET INFORMATION =====
    y = this.renderAssetInfo(doc, ticket, margin, y, pageWidth);

    // ===== DELIVERY DETAILS =====
    y = this.renderDeliveryDetails(doc, ticket, margin, y, pageWidth);

    // ===== PURPOSE =====
    if (ticket.purpose) {
      y = this.renderPurpose(doc, ticket.purpose, margin, y, pageWidth);
    }

    // ===== ACKNOWLEDGMENT =====
    y = this.renderAcknowledgment(doc, ticket, employeeSignaturePath, margin, y, pageWidth);

    // ===== FOOTER =====
    this.renderFooter(doc, ticket, companySettings);

    // Reset cursor to prevent auto page creation
    doc.x = margin;
    doc.y = margin;
  }

  /**
   * Render header with company logo
   */
  static renderHeader(doc, companySettings, margin, y, pageWidth) {
    // Company logo
    if (companySettings.logo) {
      try {
        const logoPath = path.join(__dirname, '../../uploads/logos/', companySettings.logo);
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, margin, y, { height: 50 });
        }
      } catch (e) {
        console.error('Error rendering logo:', e);
      }
    }

    // Company name and address (right aligned)
    if (companySettings.showNameInPdf || !companySettings.logo) {
      doc.font('Helvetica-Bold')
        .fontSize(14)
        .fillColor(this.colors.primary)
        .text(companySettings.name, margin + 100, y, {
          width: pageWidth - 100,
          align: 'right',
          lineBreak: false
        });

      if (companySettings.address) {
        doc.font('Helvetica')
          .fontSize(8)
          .fillColor(this.colors.gray)
          .text(companySettings.address, margin + 100, y + 18, {
            width: pageWidth - 100,
            align: 'right',
            lineBreak: false
          });
      }

      if (companySettings.phone || companySettings.email) {
        const contactInfo = [companySettings.phone, companySettings.email].filter(Boolean).join(' | ');
        doc.text(contactInfo, margin + 100, y + 30, {
          width: pageWidth - 100,
          align: 'right',
          lineBreak: false
        });
      }
    }

    doc.x = margin;
    doc.y = y + 60;
    return y + 60;
  }

  /**
   * Render title section
   */
  static renderTitle(doc, ticket, margin, y, pageWidth) {
    // Title Banner
    doc.rect(margin, y, pageWidth, 40)
      .fill(this.colors.primary);

    doc.font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(this.colors.white)
      .text('ASSET DELIVERY FORM', margin, y + 10, {
        width: pageWidth,
        align: 'center',
        lineBreak: false
      });

    y += 50;

    // Ticket Info Box
    doc.rect(margin, y, pageWidth, 35)
      .stroke(this.colors.border);

    const infoColWidth = pageWidth / 2;

    // Delivery Ticket No
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.colors.gray)
      .text('Delivery Ticket:', margin + 10, y + 8, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(this.colors.primary)
      .text(ticket.ticket_number || 'N/A', margin + 100, y + 6, { lineBreak: false });

    // Date
    const formDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.colors.gray)
      .text('Date:', margin + infoColWidth + 10, y + 8, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(11)
      .fillColor(this.colors.black)
      .text(formDate, margin + infoColWidth + 50, y + 7, { lineBreak: false });

    doc.x = margin;
    doc.y = y + 45;
    return y + 45;
  }

  /**
   * Render recipient information section
   */
  static renderRecipientInfo(doc, ticket, margin, y, pageWidth) {
    // Section Header
    doc.rect(margin, y, pageWidth, 22)
      .fill(this.colors.secondary);

    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.colors.white)
      .text('RECIPIENT INFORMATION', margin + 10, y + 6, { lineBreak: false });

    y += 25;

    // Content Box
    doc.rect(margin, y, pageWidth, 60)
      .stroke(this.colors.border);

    const colWidth = pageWidth / 2;

    // Left column
    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
    doc.text('Name:', margin + 10, y + 10, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
    doc.text(ticket.recipient_name || ticket.user_name || 'N/A', margin + 80, y + 10, { lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
    doc.text('Email:', margin + 10, y + 28, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
    doc.text(ticket.recipient_email || 'N/A', margin + 80, y + 28, { lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
    doc.text('Department:', margin + 10, y + 46, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
    doc.text(ticket.department_name || 'N/A', margin + 80, y + 46, { lineBreak: false });

    // Right column
    if (ticket.delivery_location_name) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
      doc.text('Location:', margin + colWidth + 10, y + 10, { lineBreak: false });
      doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
      doc.text(ticket.delivery_location_name, margin + colWidth + 80, y + 10, { lineBreak: false });
    }

    doc.x = margin;
    doc.y = y + 70;
    return y + 70;
  }

  /**
   * Render asset information table
   */
  static renderAssetInfo(doc, ticket, margin, y, pageWidth) {
    // Section Header
    doc.rect(margin, y, pageWidth, 22)
      .fill(this.colors.secondary);

    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.colors.white)
      .text('ASSET INFORMATION', margin + 10, y + 6, { lineBreak: false });

    y += 25;

    // Table Header
    const colWidths = { field: 150, details: pageWidth - 150 };

    doc.rect(margin, y, colWidths.field, 22).fill(this.colors.lightGray).stroke(this.colors.border);
    doc.rect(margin + colWidths.field, y, colWidths.details, 22).fill(this.colors.lightGray).stroke(this.colors.border);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.primary);
    doc.text('Field', margin + 10, y + 7, { lineBreak: false });
    doc.text('Details', margin + colWidths.field + 10, y + 7, { lineBreak: false });

    y += 22;

    // Table Rows
    const rows = [
      { field: 'Asset Tag', value: ticket.asset_tag || 'N/A' },
      { field: 'Serial Number', value: ticket.serial_number || 'N/A' },
      { field: 'Category', value: ticket.category_name || 'N/A' },
      { field: 'Product', value: `${ticket.product_name || 'N/A'}${ticket.product_model ? ' - ' + ticket.product_model : ''}` },
      { field: 'Requisition', value: ticket.requisition_number || 'N/A' }
    ];

    rows.forEach((row, index) => {
      const rowHeight = 20;
      const rowY = y + (index * rowHeight);

      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(margin, rowY, pageWidth, rowHeight).fill('#fafafa');
      }

      doc.rect(margin, rowY, colWidths.field, rowHeight).stroke(this.colors.border);
      doc.rect(margin + colWidths.field, rowY, colWidths.details, rowHeight).stroke(this.colors.border);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
      doc.text(row.field, margin + 10, rowY + 6, { lineBreak: false });

      doc.font('Helvetica').fontSize(9).fillColor(this.colors.black);
      doc.text(row.value, margin + colWidths.field + 10, rowY + 6, { lineBreak: false });
    });

    y += rows.length * 20;

    doc.x = margin;
    doc.y = y + 10;
    return y + 10;
  }

  /**
   * Render delivery details section
   */
  static renderDeliveryDetails(doc, ticket, margin, y, pageWidth) {
    // Section Header
    doc.rect(margin, y, pageWidth, 22)
      .fill(this.colors.secondary);

    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.colors.white)
      .text('DELIVERY DETAILS', margin + 10, y + 6, { lineBreak: false });

    y += 25;

    // Content Box
    doc.rect(margin, y, pageWidth, 45)
      .stroke(this.colors.border);

    const colWidth = pageWidth / 2;

    // Delivery Type
    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
    doc.text('Delivery Type:', margin + 10, y + 10, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
    doc.text((ticket.delivery_type || 'Physical').charAt(0).toUpperCase() + (ticket.delivery_type || 'physical').slice(1), margin + 100, y + 10, { lineBreak: false });

    // Scheduled Date
    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
    doc.text('Scheduled Date:', margin + colWidth + 10, y + 10, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
    const scheduledDate = ticket.scheduled_delivery_date
      ? new Date(ticket.scheduled_delivery_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Not scheduled';
    doc.text(scheduledDate, margin + colWidth + 110, y + 10, { lineBreak: false });

    // Delivered By
    if (ticket.delivered_by_name) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.gray);
      doc.text('Delivered By:', margin + 10, y + 28, { lineBreak: false });
      doc.font('Helvetica').fontSize(10).fillColor(this.colors.black);
      doc.text(ticket.delivered_by_name, margin + 100, y + 28, { lineBreak: false });
    }

    doc.x = margin;
    doc.y = y + 55;
    return y + 55;
  }

  /**
   * Render purpose section
   */
  static renderPurpose(doc, purpose, margin, y, pageWidth) {
    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.primary)
      .text('Purpose:', margin, y, { lineBreak: false });

    y += 15;

    doc.rect(margin, y, pageWidth, 40)
      .stroke(this.colors.border);

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text(purpose, margin + 10, y + 8, {
        width: pageWidth - 20,
        height: 30
      });

    doc.x = margin;
    doc.y = y + 50;
    return y + 50;
  }

  /**
   * Render acknowledgment section
   */
  static renderAcknowledgment(doc, ticket, employeeSignaturePath, margin, y, pageWidth) {
    // Section Header
    doc.rect(margin, y, pageWidth, 22)
      .fill(this.colors.success);

    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.colors.white)
      .text('RECIPIENT ACKNOWLEDGMENT', margin + 10, y + 6, { lineBreak: false });

    y += 30;

    // Acknowledgment text
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text('I acknowledge receipt of the above asset in good working condition and agree to use it responsibly according to company policies.', margin, y, {
        width: pageWidth,
        align: 'left'
      });

    y += 35;

    // Signature boxes
    const boxWidth = (pageWidth - 30) / 2;
    const boxHeight = 80;

    // Recipient Signature
    doc.rect(margin, y, boxWidth, boxHeight)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.colors.gray)
      .text('Recipient Signature:', margin + 10, y + 8, { lineBreak: false });

    // Add signature image if exists
    if (employeeSignaturePath) {
      try {
        const signaturePath = path.join(__dirname, '../..', employeeSignaturePath);
        if (fs.existsSync(signaturePath)) {
          doc.image(signaturePath, margin + 10, y + 22, { height: 40 });
        }
      } catch (e) {
        console.error('Error rendering signature:', e);
      }
    }

    const confirmDate = ticket.employee_confirmed_at
      ? new Date(ticket.employee_confirmed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '____________________';

    doc.font('Helvetica')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text(`Date: ${confirmDate}`, margin + 10, y + boxHeight - 15, { lineBreak: false });

    // Engineer/Delivered By Signature
    const engX = margin + boxWidth + 30;
    doc.rect(engX, y, boxWidth, boxHeight)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.colors.gray)
      .text('Delivered By:', engX + 10, y + 8, { lineBreak: false });

    doc.font('Helvetica')
      .fontSize(10)
      .fillColor(this.colors.black)
      .text(ticket.delivered_by_name || '____________________', engX + 10, y + 25, { lineBreak: false });

    doc.fontSize(8)
      .fillColor(this.colors.gray)
      .text('Signature: ____________________', engX + 10, y + boxHeight - 15, { lineBreak: false });

    doc.x = margin;
    doc.y = y + boxHeight + 10;
    return y + boxHeight + 10;
  }

  /**
   * Render footer with company branding
   */
  static renderFooter(doc, ticket, companySettings) {
    const footerY = doc.page.height - 40;
    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;

    // Draw footer line
    doc.moveTo(margin, footerY - 5)
      .lineTo(margin + pageWidth, footerY - 5)
      .strokeColor(this.colors.border)
      .lineWidth(0.5)
      .stroke();

    // Save graphics state
    doc.save();

    // Footer text - left aligned
    doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
    doc.text('Report Generated from Poleplus ITSM ©2026. Polestar Consulting Pvt. Ltd.',
      margin, footerY, { lineBreak: false }
    );

    // Page number - right aligned
    doc.text('Page 1 of 1',
      margin + pageWidth - 80, footerY, { lineBreak: false }
    );

    // Restore graphics state to prevent blank page
    doc.restore();
  }
}

module.exports = DeliveryFormPDF;
