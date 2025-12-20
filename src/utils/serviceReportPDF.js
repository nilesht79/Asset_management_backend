/**
 * SERVICE REPORT PDF GENERATOR
 * Professional PDF documents for service reports with dynamic company logo
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('../config/database');

class ServiceReportPDF {
  // Colors
  static colors = {
    primary: '#1a365d',
    secondary: '#2b6cb0',
    success: '#38a169',
    warning: '#dd6b20',
    purple: '#805ad5',
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
          WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS', 'SHOW_COMPANY_NAME_IN_PDF')
        `);

      const settings = {};
      result.recordset.forEach(row => {
        settings[row.config_key] = row.config_value;
      });

      return {
        logo: settings.COMPANY_LOGO || null,
        name: settings.COMPANY_NAME || 'Asset Management System',
        address: settings.COMPANY_ADDRESS || '',
        showNameInPdf: settings.SHOW_COMPANY_NAME_IN_PDF === 'true' || settings.SHOW_COMPANY_NAME_IN_PDF === '1' || settings.SHOW_COMPANY_NAME_IN_PDF === undefined
      };
    } catch (error) {
      console.error('Error fetching company settings:', error);
      return { logo: null, name: 'Asset Management System', address: '' };
    }
  }

  /**
   * Generate PDF for a single service report
   */
  static async generateSingleReport(report, options = {}) {
    const companySettings = await this.getCompanySettings();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 50,
          size: 'A4',
          autoFirstPage: true
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.renderReport(doc, report, companySettings, options);
        this.addFooter(doc, 1, 1);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate PDF for multiple service reports (bulk)
   */
  static async generateBulkReport(reports, options = {}) {
    const companySettings = await this.getCompanySettings();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 50,
          size: 'A4',
          autoFirstPage: false
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        reports.forEach((report, index) => {
          doc.addPage();
          this.renderReport(doc, report, companySettings, options);
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
  static renderReport(doc, report, companySettings, options = {}) {
    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;
    const maxY = doc.page.height - 80; // Leave space for footer
    let y = margin;
    const hideCost = options.hideCost || false;

    // ===== HEADER =====
    y = this.renderHeader(doc, report, companySettings, margin, y, pageWidth);

    // ===== SERVICE TYPE BANNER =====
    y = this.renderBanner(doc, report, margin, y, pageWidth);

    // ===== TWO COLUMN LAYOUT =====
    const colWidth = (pageWidth - 10) / 2;
    const col1X = margin;
    const col2X = margin + colWidth + 10;

    // Left column
    let leftY = y;
    leftY = this.renderInfoBox(doc, 'Report Information', col1X, leftY, colWidth, [
      ['Report #', report.report_number || 'N/A'],
      ['Date', this.formatDate(report.created_at)],
      ['Ticket #', report.ticket_number || 'N/A'],
      ['Ticket Title', report.ticket_title || 'N/A']
    ]);

    leftY += 5;
    const assetRows = [
      ['Asset Tag', report.asset_tag || 'N/A'],
      ['Serial #', report.asset_serial || 'N/A'],
      ['Product', report.asset_product_name || 'N/A'],
      ['Model', report.asset_model || 'N/A'],
      ['Category', report.asset_category || 'N/A']
    ];
    if (report.service_type === 'replace' && report.replacement_asset_tag) {
      assetRows.push(['New Asset', report.replacement_asset_tag]);
    }
    leftY = this.renderInfoBox(doc, 'Asset Information', col1X, leftY, colWidth, assetRows);

    // Right column
    let rightY = y;
    rightY = this.renderInfoBox(doc, 'User & Location', col2X, rightY, colWidth, [
      ['Raised By', report.raised_by_name || 'N/A'],
      ['Email', report.raised_by_email || 'N/A'],
      ['Department', report.department_name || 'N/A'],
      ['Location', report.location_name || 'N/A']
    ]);

    rightY += 5;
    rightY = this.renderInfoBox(doc, 'Service Engineer', col2X, rightY, colWidth, [
      ['Name', report.engineer_name || 'N/A'],
      ['Email', report.engineer_email || 'N/A']
    ]);

    // Condition box only for repair service
    if (report.service_type === 'repair') {
      rightY += 5;
      rightY = this.renderConditionBox(doc, report, col2X, rightY, colWidth);
    }

    // Move below both columns
    y = Math.max(leftY, rightY) + 6;

    // ===== FULL WIDTH SECTIONS (with bounds check) =====
    if (y < maxY - 80) {
      y = this.renderTextBox(doc, 'Diagnosis / Problem Found',
        report.diagnosis || 'No diagnosis recorded', margin, y, pageWidth);
    }

    if (y < maxY - 80) {
      y = this.renderTextBox(doc, 'Work Performed',
        report.work_performed || 'No work details recorded', margin, y, pageWidth);
    }

    if (report.engineer_notes && y < maxY - 80) {
      y = this.renderTextBox(doc, 'Additional Notes', report.engineer_notes, margin, y, pageWidth);
    }

    // ===== SPARE PARTS TABLE (with bounds check) =====
    if (report.parts_used && report.parts_used.length > 0 && y < maxY - 60) {
      y = this.renderPartsTable(doc, report.parts_used, margin, y, pageWidth, hideCost);
    }

    // ===== COST SUMMARY (with bounds check) - Only show if hideCost is false =====
    if (!hideCost && y < maxY) {
      this.renderCostSummary(doc, report, margin, y, pageWidth);
    }

    // Reset cursor to prevent auto page creation
    doc.x = margin;
    doc.y = margin;
  }

  /**
   * Render header with logo
   */
  static renderHeader(doc, report, companySettings, x, y, width) {
    // Company logo and name
    let textX = x;
    if (companySettings.logo) {
      try {
        const logoPath = path.join(__dirname, '../../uploads/logos/', companySettings.logo);
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, x, y, { height: 45 });
          textX = x + 55;
        }
      } catch (e) { /* ignore */ }
    }

    // Only show company name/address if showNameInPdf is true or no logo
    if (companySettings.showNameInPdf || !companySettings.logo) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(this.colors.primary);
      doc.text(companySettings.name, textX, y + 5, { width: 180, lineBreak: false });

      if (companySettings.address) {
        doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
        doc.text(companySettings.address, textX, y + 20, { width: 180, lineBreak: false });
      }
    }

    // Report title (right side) - with proper spacing to prevent overlap
    const rightX = x + width - 130;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(this.colors.primary);
    doc.text('SERVICE REPORT', rightX, y, { width: 130, align: 'right', lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.secondary);
    doc.text(report.report_number || '', rightX, y + 18, { width: 130, align: 'right', lineBreak: false });

    doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
    doc.text(`Generated: ${this.formatDateTime(new Date())}`, rightX, y + 32, { width: 130, align: 'right', lineBreak: false });

    // Horizontal line
    y += 48;
    doc.moveTo(x, y).lineTo(x + width, y).strokeColor(this.colors.border).lineWidth(1).stroke();

    return y + 8;
  }

  /**
   * Render service type banner
   */
  static renderBanner(doc, report, x, y, width) {
    const isRepair = report.service_type === 'repair';
    const color = isRepair ? this.colors.warning : this.colors.purple;
    const text = isRepair ? 'REPAIR SERVICE' : 'REPLACEMENT SERVICE';

    doc.rect(x, y, width, 20).fill(color);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.white);
    doc.text(text, x + 10, y + 5, { width: width - 20, lineBreak: false });

    return y + 26;
  }

  /**
   * Render info box with label-value pairs
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
      doc.text(label + ':', x + padding, rowY, { width: 60, lineBreak: false });

      doc.font('Helvetica').fontSize(7).fillColor(this.colors.black);
      doc.text(String(value || 'N/A'), x + padding + 62, rowY, { width: width - padding * 2 - 62, lineBreak: false });

      rowY += rowH;
    });

    return y + boxH;
  }

  /**
   * Render condition comparison box
   */
  static renderConditionBox(doc, report, x, y, width) {
    const titleH = 16;
    const contentH = 35;
    const boxH = titleH + contentH;
    const padding = 6;

    // Border
    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    // Title bar
    doc.rect(x, y, width, titleH).fill(this.colors.primary);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.white);
    doc.text('Asset Condition', x + padding, y + 4, { lineBreak: false });

    // Condition badges
    const badgeW = (width - padding * 3) / 2;
    const badgeY = y + titleH + 14;

    // Before
    doc.font('Helvetica').fontSize(6).fillColor(this.colors.gray);
    doc.text('BEFORE', x + padding, y + titleH + 4, { lineBreak: false });

    const beforeColor = this.getConditionColor(report.condition_before);
    doc.rect(x + padding, badgeY, badgeW, 14).fill(beforeColor);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(this.colors.white);
    doc.text(this.formatCondition(report.condition_before), x + padding + 4, badgeY + 3, { width: badgeW - 8, lineBreak: false });

    // After
    doc.font('Helvetica').fontSize(6).fillColor(this.colors.gray);
    doc.text('AFTER', x + padding * 2 + badgeW, y + titleH + 4, { lineBreak: false });

    const afterColor = this.getConditionColor(report.condition_after);
    doc.rect(x + padding * 2 + badgeW, badgeY, badgeW, 14).fill(afterColor);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(this.colors.white);
    doc.text(this.formatCondition(report.condition_after), x + padding * 2 + badgeW + 4, badgeY + 3, { width: badgeW - 8, lineBreak: false });

    return y + boxH;
  }

  /**
   * Render text box (diagnosis, work performed, etc.)
   */
  static renderTextBox(doc, title, content, x, y, width) {
    const titleH = 14;
    const padding = 6;
    const maxTextH = 40; // Fixed max height for text content

    // Truncate content to prevent overflow
    const truncatedContent = content.length > 200 ? content.substring(0, 200) + '...' : content;
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
   * Render spare parts table
   */
  static renderPartsTable(doc, parts, x, y, width, hideCost = false) {
    const titleH = 14;
    const headerH = 12;
    const rowH = 11;
    const padding = 4;
    // Limit to 3 parts to prevent overflow
    const displayParts = parts.slice(0, 3);
    const tableH = titleH + headerH + displayParts.length * rowH + padding;

    // Columns - conditionally hide cost columns
    const cols = hideCost ? [
      { label: 'Part Name', w: width * 0.50 },
      { label: 'Asset Tag', w: width * 0.35 },
      { label: 'Qty', w: width * 0.15 }
    ] : [
      { label: 'Part Name', w: width * 0.35 },
      { label: 'Asset Tag', w: width * 0.20 },
      { label: 'Qty', w: width * 0.10 },
      { label: 'Unit Cost', w: width * 0.17 },
      { label: 'Total', w: width * 0.18 }
    ];

    // Border
    doc.rect(x, y, width, tableH).strokeColor(this.colors.border).lineWidth(1).stroke();

    // Title bar
    doc.rect(x, y, width, titleH).fill(this.colors.lightGray);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.primary);
    doc.text('Spare Parts Used' + (parts.length > 3 ? ` (showing 3 of ${parts.length})` : ''), x + padding, y + 3, { lineBreak: false });

    // Header row
    const headerY = y + titleH;
    doc.rect(x, headerY, width, headerH).fill(this.colors.primary);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(this.colors.white);

    let colX = x;
    cols.forEach(col => {
      doc.text(col.label, colX + 2, headerY + 3, { width: col.w - 4, lineBreak: false });
      colX += col.w;
    });

    // Data rows
    let rowY = headerY + headerH;
    displayParts.forEach((part, i) => {
      if (i % 2 === 0) {
        doc.rect(x, rowY, width, rowH).fill('#f7fafc');
      }

      doc.font('Helvetica').fontSize(7).fillColor(this.colors.black);
      colX = x;

      // Values - conditionally exclude cost columns
      const values = hideCost ? [
        part.product_name || 'N/A',
        part.asset_tag || 'N/A',
        String(part.quantity || 1)
      ] : [
        part.product_name || 'N/A',
        part.asset_tag || 'N/A',
        String(part.quantity || 1),
        `₹${parseFloat(part.unit_cost || 0).toFixed(2)}`,
        `₹${parseFloat(part.total_cost || 0).toFixed(2)}`
      ];

      values.forEach((val, j) => {
        doc.text(val, colX + 2, rowY + 2, { width: cols[j].w - 4, lineBreak: false });
        colX += cols[j].w;
      });

      rowY += rowH;
    });

    // Reset cursor position
    doc.x = x;
    doc.y = y + tableH;

    return y + tableH + 6;
  }

  /**
   * Render cost summary
   */
  static renderCostSummary(doc, report, x, y, pageWidth) {
    const boxW = 160;
    const boxH = 55;
    const boxX = x + pageWidth - boxW;
    const padding = 8;

    const partsCost = parseFloat(report.total_parts_cost || 0);
    const laborCost = parseFloat(report.labor_cost || 0);
    const totalCost = partsCost + laborCost;

    // Box
    doc.rect(boxX, y, boxW, boxH).strokeColor(this.colors.primary).lineWidth(1).stroke();

    // Title
    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.primary);
    doc.text('Cost Summary', boxX + padding, y + 6, { lineBreak: false });

    // Items
    doc.font('Helvetica').fontSize(8).fillColor(this.colors.gray);
    doc.text('Parts Cost:', boxX + padding, y + 20, { lineBreak: false });
    doc.text(`₹${partsCost.toFixed(2)}`, boxX + boxW - padding - 50, y + 20, { width: 50, align: 'right', lineBreak: false });

    doc.text('Labor Cost:', boxX + padding, y + 32, { lineBreak: false });
    doc.text(`₹${laborCost.toFixed(2)}`, boxX + boxW - padding - 50, y + 32, { width: 50, align: 'right', lineBreak: false });

    // Total
    doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.success);
    doc.text('Total:', boxX + padding, y + 44, { lineBreak: false });
    doc.text(`₹${totalCost.toFixed(2)}`, boxX + boxW - padding - 55, y + 44, { width: 55, align: 'right', lineBreak: false });

    // Reset cursor position
    doc.x = x;
    doc.y = y + boxH;
  }

  /**
   * Add footer to page with company branding and page numbers
   */
  static addFooter(doc, pageNum, totalPages) {
    const footerY = doc.page.height - 30;
    const x = 40;
    const width = doc.page.width - 80;

    // Draw footer line
    doc.moveTo(x, footerY - 8).lineTo(x + width, footerY - 8).strokeColor(this.colors.border).lineWidth(0.5).stroke();

    // Save graphics state
    doc.save();

    // Footer text - left aligned with explicit positioning
    doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
    doc.text('Report Generated from Poleplus ITSM ©2026. Polestar Consulting Pvt. Ltd.',
      x, footerY, { lineBreak: false }
    );

    // Page number - right aligned with explicit positioning
    doc.text(`Page ${pageNum} of ${totalPages}`,
      x + width - 80, footerY, { lineBreak: false }
    );

    // Restore graphics state to prevent page creation
    doc.restore();
  }

  // Helper methods
  static formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  static formatDateTime(date) {
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  static formatCondition(condition) {
    const map = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged', non_functional: 'Non-Functional', new: 'New' };
    return map[condition] || condition || 'N/A';
  }

  static getConditionColor(condition) {
    const map = { excellent: '#38a169', good: '#48bb78', fair: '#ecc94b', poor: '#dd6b20', damaged: '#e53e3e', non_functional: '#c53030', new: '#2b6cb0' };
    return map[condition] || '#718096';
  }
}

module.exports = ServiceReportPDF;
