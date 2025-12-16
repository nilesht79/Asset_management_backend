/**
 * ASSET JOB REPORT PDF GENERATOR
 * Professional PDF documents for IT Asset Install, Move, and Transfer reports
 * with dynamic company logo - Based on Service Report PDF pattern
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('../config/database');

class AssetJobReportPDF {
  // Colors
  static colors = {
    primary: '#1a365d',
    secondary: '#2b6cb0',
    success: '#38a169',
    warning: '#dd6b20',
    purple: '#805ad5',
    cyan: '#0891b2',
    gray: '#718096',
    lightGray: '#f7fafc',
    border: '#e2e8f0',
    white: '#ffffff',
    black: '#2d3748'
  };

  // Job type configurations
  static jobTypeConfig = {
    install: {
      title: 'IT ASSET INSTALL JOB REPORT',
      color: '#38a169', // Green
      description: 'First-time asset assignment to user'
    },
    move: {
      title: 'IT ASSET MOVE JOB REPORT',
      color: '#0891b2', // Cyan
      description: 'Asset relocation / movement'
    },
    transfer: {
      title: 'IT ASSET TRANSFER REPORT',
      color: '#dd6b20', // Orange
      description: 'Asset reassignment between users'
    }
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
          WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS')
        `);

      const settings = {};
      result.recordset.forEach(row => {
        settings[row.config_key] = row.config_value;
      });

      return {
        logo: settings.COMPANY_LOGO || null,
        name: settings.COMPANY_NAME || 'Asset Management System',
        address: settings.COMPANY_ADDRESS || ''
      };
    } catch (error) {
      console.error('Error fetching company settings:', error);
      return { logo: null, name: 'Asset Management System', address: '' };
    }
  }

  /**
   * Generate PDF for a single job report
   */
  static async generateSingleReport(report) {
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

        this.renderReport(doc, report, companySettings);
        this.addFooter(doc, 1, 1);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate PDF for multiple job reports (bulk)
   */
  static async generateBulkReport(reports) {
    const companySettings = await this.getCompanySettings();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 40,
          size: 'A4',
          autoFirstPage: false
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        reports.forEach((report, index) => {
          doc.addPage();
          this.renderReport(doc, report, companySettings);
          this.addFooter(doc, index + 1, reports.length);
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Render full report on current page
   */
  static renderReport(doc, report, companySettings) {
    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;
    const maxY = doc.page.height - 100; // Leave space for footer and signatures
    let y = margin;

    // Get job type config
    const jobType = report.job_type || 'install';
    const config = this.jobTypeConfig[jobType] || this.jobTypeConfig.install;

    // ===== HEADER =====
    y = this.renderHeader(doc, report, companySettings, config, margin, y, pageWidth);

    // ===== JOB TYPE BANNER =====
    y = this.renderBanner(doc, config, margin, y, pageWidth);

    // ===== TWO COLUMN LAYOUT =====
    const colWidth = (pageWidth - 10) / 2;
    const col1X = margin;
    const col2X = margin + colWidth + 10;

    // Left column - Report Info & Asset Details
    let leftY = y;
    leftY = this.renderInfoBox(doc, 'Report Information', col1X, leftY, colWidth, [
      ['Report #', `JOB-${String(report.movement_id).substring(0, 8).toUpperCase()}`],
      ['Date', this.formatDateTime(report.movement_date)],
      ['Job Type', this.getJobTypeDisplay(report.job_type)],
      ['Status', report.status ? report.status.toUpperCase() : 'N/A']
    ]);

    leftY += 5;
    leftY = this.renderInfoBox(doc, 'Asset Details', col1X, leftY, colWidth, [
      ['Asset Tag', report.asset_tag || 'N/A'],
      ['Serial #', report.serial_number || 'N/A'],
      ['Product', report.product_name || 'N/A'],
      ['Model', report.product_model || 'N/A'],
      ['Category', report.category_name || 'N/A'],
      ['OEM', report.oem_name || 'N/A']
    ]);

    // Right column - Assignment & Location
    let rightY = y;

    if (jobType === 'transfer') {
      // For transfers, show FROM and TO in two separate boxes
      rightY = this.renderInfoBox(doc, 'From (Previous)', col2X, rightY, colWidth, [
        ['Name', report.previous_user_name || 'N/A'],
        ['Emp Code', report.previous_user_emp_code || 'N/A'],
        ['Department', report.previous_user_department || 'N/A'],
        ['Location', report.previous_location_name || 'N/A']
      ]);

      rightY += 5;
      rightY = this.renderInfoBox(doc, 'To (New)', col2X, rightY, colWidth, [
        ['Name', report.assigned_to_name || 'N/A'],
        ['Emp Code', report.assigned_to_emp_code || 'N/A'],
        ['Department', report.assigned_to_department || 'N/A'],
        ['Location', report.location_name || 'N/A']
      ]);
    } else {
      // For install/move, show assigned user and location
      rightY = this.renderInfoBox(doc, 'Assigned To', col2X, rightY, colWidth, [
        ['Name', report.assigned_to_name || 'N/A'],
        ['Emp Code', report.assigned_to_emp_code || 'N/A'],
        ['Email', report.assigned_to_email || 'N/A'],
        ['Department', report.assigned_to_department || 'N/A']
      ]);

      rightY += 5;
      rightY = this.renderInfoBox(doc, 'Location', col2X, rightY, colWidth, [
        ['Location', report.location_name || 'N/A'],
        ['Building', report.location_building || 'N/A'],
        ['Floor', report.location_floor || 'N/A']
      ]);

      // For move type, show previous location
      if (jobType === 'move' && report.previous_location_name) {
        rightY += 5;
        rightY = this.renderInfoBox(doc, 'Previous Location', col2X, rightY, colWidth, [
          ['Location', report.previous_location_name || 'N/A'],
          ['Building', report.previous_location_building || 'N/A'],
          ['Floor', report.previous_location_floor || 'N/A']
        ]);
      }
    }

    // Move below both columns
    y = Math.max(leftY, rightY) + 6;

    // ===== REMARKS (with bounds check) =====
    if ((report.reason || report.notes) && y < maxY - 100) {
      y = this.renderTextBox(doc, 'Remarks / Notes',
        (report.reason ? `Reason: ${report.reason}\n` : '') + (report.notes || ''),
        margin, y, pageWidth);
    }

    // ===== PERFORMED BY =====
    if (y < maxY - 80) {
      y = this.renderPerformedBy(doc, report, margin, y, pageWidth);
    }

    // ===== SIGNATURE SECTION =====
    this.renderSignatureSection(doc, margin, Math.max(y, maxY - 80), pageWidth);

    // Reset cursor to prevent auto page creation
    doc.x = margin;
    doc.y = margin;
  }

  /**
   * Render header with logo
   */
  static renderHeader(doc, report, companySettings, config, x, y, width) {
    // Company logo and name
    let textX = x;
    if (companySettings.logo) {
      try {
        const logoPath = path.join(__dirname, '../../uploads/logos/', companySettings.logo);
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, x, y, { width: 45, height: 45 });
          textX = x + 55;
        }
      } catch (e) { /* ignore */ }
    }

    doc.font('Helvetica-Bold').fontSize(13).fillColor(this.colors.primary);
    doc.text(companySettings.name, textX, y + 5, { width: 180, lineBreak: false });

    if (companySettings.address) {
      doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
      doc.text(companySettings.address, textX, y + 20, { width: 180, lineBreak: false });
    }

    // Report title (right side) - with proper spacing to prevent overlap
    const rightX = x + width - 140;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(config.color);
    doc.text(config.title, rightX, y, { width: 140, align: 'right', lineBreak: false });

    doc.font('Helvetica').fontSize(8).fillColor(this.colors.gray);
    doc.text(`Report #: JOB-${String(report.movement_id).substring(0, 8).toUpperCase()}`, rightX, y + 16, { width: 140, align: 'right', lineBreak: false });

    doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
    doc.text(`Generated: ${this.formatDateTime(new Date())}`, rightX, y + 28, { width: 140, align: 'right', lineBreak: false });

    // Horizontal line
    y += 48;
    doc.moveTo(x, y).lineTo(x + width, y).strokeColor(this.colors.border).lineWidth(1).stroke();

    return y + 8;
  }

  /**
   * Render job type banner
   */
  static renderBanner(doc, config, x, y, width) {
    doc.rect(x, y, width, 22).fill(config.color);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.white);
    doc.text(config.title, x + 10, y + 6, { width: width - 20, lineBreak: false });

    return y + 28;
  }

  /**
   * Render info box with label-value pairs (like service report)
   */
  static renderInfoBox(doc, title, x, y, width, rows) {
    const titleH = 16;
    const rowH = 12;
    const padding = 6;
    const boxH = titleH + rows.length * rowH + padding;

    // Border
    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    // Title bar
    doc.rect(x, y, width, titleH).fill(this.colors.primary);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.white);
    doc.text(title, x + padding, y + 4, { width: width - padding * 2, lineBreak: false });

    // Rows
    let rowY = y + titleH + 3;
    rows.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').fontSize(7).fillColor(this.colors.gray);
      doc.text(label + ':', x + padding, rowY, { width: 70, lineBreak: false });

      doc.font('Helvetica').fontSize(7).fillColor(this.colors.black);
      const displayValue = String(value || 'N/A').substring(0, 40);
      doc.text(displayValue, x + padding + 72, rowY, { width: width - padding * 2 - 72, lineBreak: false });

      rowY += rowH;
    });

    return y + boxH;
  }

  /**
   * Render text box (remarks, notes)
   */
  static renderTextBox(doc, title, content, x, y, width) {
    const titleH = 14;
    const padding = 6;
    const maxTextH = 45;

    // Truncate content to prevent overflow
    const truncatedContent = content.length > 250 ? content.substring(0, 250) + '...' : content;
    const boxH = titleH + maxTextH + padding;

    // Border
    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    // Title bar
    doc.rect(x, y, width, titleH).fill(this.colors.lightGray);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.primary);
    doc.text(title, x + padding, y + 3, { lineBreak: false });

    // Content - use save/restore to clip text within bounds
    doc.save();
    doc.rect(x + padding, y + titleH + padding, width - padding * 2, maxTextH - padding).clip();
    doc.font('Helvetica').fontSize(8).fillColor(this.colors.black);
    doc.text(truncatedContent, x + padding, y + titleH + padding, { width: width - padding * 2, lineBreak: true });
    doc.restore();

    // Reset cursor position
    doc.x = x;
    doc.y = y + boxH;

    return y + boxH + 4;
  }

  /**
   * Render performed by section
   */
  static renderPerformedBy(doc, report, x, y, width) {
    const boxH = 30;
    const padding = 8;

    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.gray);
    doc.text('Performed By:', x + padding, y + 8, { lineBreak: false });

    doc.font('Helvetica').fontSize(8).fillColor(this.colors.black);
    doc.text(report.performed_by_name || 'N/A', x + padding + 80, y + 8, { lineBreak: false });

    if (report.performed_by_email) {
      doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
      doc.text(report.performed_by_email, x + padding + 80, y + 18, { lineBreak: false });
    }

    return y + boxH + 6;
  }

  /**
   * Render signature section
   */
  static renderSignatureSection(doc, x, y, width) {
    const boxWidth = (width - 20) / 3;
    const boxH = 50;

    // IT Department signature
    doc.rect(x, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
    doc.text('IT Department', x + 5, y + boxH - 18, { width: boxWidth - 10, align: 'center', lineBreak: false });
    doc.text('Signature & Date', x + 5, y + boxH - 10, { width: boxWidth - 10, align: 'center', lineBreak: false });

    // User Acknowledgment
    doc.rect(x + boxWidth + 10, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.text('User Acknowledgment', x + boxWidth + 15, y + boxH - 18, { width: boxWidth - 10, align: 'center', lineBreak: false });
    doc.text('Signature & Date', x + boxWidth + 15, y + boxH - 10, { width: boxWidth - 10, align: 'center', lineBreak: false });

    // Supervisor
    doc.rect(x + (boxWidth + 10) * 2, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.text('Supervisor', x + (boxWidth + 10) * 2 + 5, y + boxH - 18, { width: boxWidth - 10, align: 'center', lineBreak: false });
    doc.text('Signature & Date', x + (boxWidth + 10) * 2 + 5, y + boxH - 10, { width: boxWidth - 10, align: 'center', lineBreak: false });
  }

  /**
   * Add footer - uses only line drawing to avoid page creation issues
   */
  static addFooter(doc, pageNum, totalPages) {
    const footerY = doc.page.height - 20;
    const x = 40;
    const width = doc.page.width - 80;

    // Draw footer line only
    doc.moveTo(x, footerY - 8).lineTo(x + width, footerY - 8).strokeColor(this.colors.border).lineWidth(0.5).stroke();
  }

  // ===== UTILITY FUNCTIONS =====

  static formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  static formatDateTime(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  static getJobTypeDisplay(jobType) {
    const types = {
      install: 'Installation',
      move: 'Movement',
      transfer: 'Transfer'
    };
    return types[jobType] || jobType || 'N/A';
  }
}

module.exports = AssetJobReportPDF;
