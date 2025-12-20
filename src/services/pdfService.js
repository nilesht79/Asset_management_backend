/**
 * PDF Service
 * Generates PDF labels with QR codes for assets
 */

const PDFDocument = require('pdfkit')
const QRCode = require('qrcode')

/**
 * Generate a single asset label as PDF
 * @param {Object} assetData - Asset data with label information
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateAssetLabelPDF(assetData) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create PDF document (4" x 2" label size = 288 x 144 points)
      const doc = new PDFDocument({
        size: [288, 144],
        margins: {
          top: 10,
          bottom: 10,
          left: 10,
          right: 10
        }
      })

      const buffers = []
      doc.on('data', buffers.push.bind(buffers))
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers)
        resolve(pdfData)
      })
      doc.on('error', reject)

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(assetData.assetCode, {
        width: 80,
        margin: 1,
        errorCorrectionLevel: 'M'
      })

      // Draw border
      doc.rect(5, 5, 278, 134).stroke()

      // Header Section - Polestar branding
      doc.fontSize(10)
        .font('Helvetica-Bold')
        .text('POLESTAR', 10, 12, { width: 268, align: 'center' })

      doc.fontSize(6)
        .font('Helvetica')
        .text('Asset Management System', 10, 24, { width: 268, align: 'center' })

      // Divider line
      doc.moveTo(10, 35).lineTo(278, 35).stroke()

      // QR Code (left side)
      const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64')
      doc.image(qrBuffer, 15, 42, { width: 80, height: 80 })

      // Asset Code (large, centered below QR)
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text(assetData.assetCode, 10, 125, { width: 90, align: 'center' })

      // Asset Details (right side)
      let yPosition = 42

      // Asset Tag
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text('Asset:', 105, yPosition)
      doc.fontSize(7)
        .font('Helvetica')
        .text(assetData.asset_tag || 'N/A', 135, yPosition, { width: 140 })

      yPosition += 12

      // Product Name
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text('Product:', 105, yPosition)
      const productText = assetData.product_name || 'N/A'
      doc.fontSize(6)
        .font('Helvetica')
        .text(productText, 135, yPosition, { width: 140, ellipsis: true })

      yPosition += 12

      // Serial Number
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text('Serial:', 105, yPosition)
      doc.fontSize(6)
        .font('Helvetica')
        .text(assetData.serial_number || 'N/A', 135, yPosition, { width: 140, ellipsis: true })

      yPosition += 12

      // Location
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text('Location:', 105, yPosition)
      const locationText = assetData.location_name || 'N/A'
      doc.fontSize(6)
        .font('Helvetica')
        .text(locationText, 135, yPosition, { width: 140, ellipsis: true })

      yPosition += 12

      // Department
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text('Dept:', 105, yPosition)
      const deptText = assetData.department_name || 'N/A'
      doc.fontSize(6)
        .font('Helvetica')
        .text(deptText, 135, yPosition, { width: 140, ellipsis: true })

      yPosition += 12

      // Status
      doc.fontSize(7)
        .font('Helvetica-Bold')
        .text('Status:', 105, yPosition)
      doc.fontSize(6)
        .font('Helvetica')
        .text(assetData.status ? assetData.status.toUpperCase() : 'N/A', 135, yPosition)

      // Footer - Generated date and branding
      doc.fontSize(5)
        .font('Helvetica')
        .text(`Poleplus ITSM ©️ 2026 | Generated: ${new Date().toLocaleDateString('en-GB')}`, 10, 133, {
          width: 268,
          align: 'center'
        })

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Generate multiple asset labels in a single PDF
 * @param {Array<Object>} assetsData - Array of asset data
 * @returns {Promise<Buffer>} PDF buffer with all labels
 */
async function generateBulkAssetLabelsPDF(assetsData) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create PDF document with A4 size for multiple labels
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 20,
          bottom: 20,
          left: 20,
          right: 20
        }
      })

      const buffers = []
      doc.on('data', buffers.push.bind(buffers))
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers)
        resolve(pdfData)
      })
      doc.on('error', reject)

      // Label dimensions (4" x 2" = 288 x 144 points)
      const labelWidth = 288
      const labelHeight = 144
      const spacing = 10

      // A4 dimensions (595 x 842 points)
      const pageWidth = 595
      const pageHeight = 842
      const marginLeft = 20
      const marginTop = 20

      // Calculate labels per row and per page
      const labelsPerRow = Math.floor((pageWidth - 2 * marginLeft) / (labelWidth + spacing))
      const labelsPerColumn = Math.floor((pageHeight - 2 * marginTop) / (labelHeight + spacing))
      const labelsPerPage = labelsPerRow * labelsPerColumn

      for (let i = 0; i < assetsData.length; i++) {
        const asset = assetsData[i]

        // Add new page if needed (except for first label)
        if (i > 0 && i % labelsPerPage === 0) {
          doc.addPage()
        }

        // Calculate position on current page
        const positionOnPage = i % labelsPerPage
        const row = Math.floor(positionOnPage / labelsPerRow)
        const col = positionOnPage % labelsPerRow

        const x = marginLeft + col * (labelWidth + spacing)
        const y = marginTop + row * (labelHeight + spacing)

        // Generate QR code
        const qrCodeDataUrl = await QRCode.toDataURL(asset.assetCode, {
          width: 80,
          margin: 1,
          errorCorrectionLevel: 'M'
        })

        // Draw label border
        doc.rect(x, y, labelWidth, labelHeight).stroke()

        // Header - Polestar
        doc.fontSize(10)
          .font('Helvetica-Bold')
          .text('POLESTAR', x, y + 7, { width: labelWidth, align: 'center' })

        doc.fontSize(6)
          .font('Helvetica')
          .text('Asset Management System', x, y + 19, { width: labelWidth, align: 'center' })

        // Divider
        doc.moveTo(x + 5, y + 30).lineTo(x + labelWidth - 5, y + 30).stroke()

        // QR Code
        const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64')
        doc.image(qrBuffer, x + 10, y + 37, { width: 80, height: 80 })

        // Asset Code
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text(asset.assetCode, x + 5, y + 120, { width: 90, align: 'center' })

        // Asset Details (right side)
        let yPos = y + 37

        // Asset Tag
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text('Asset:', x + 100, yPos)
        doc.fontSize(7)
          .font('Helvetica')
          .text(asset.asset_tag || 'N/A', x + 130, yPos, { width: 140 })

        yPos += 12

        // Product
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text('Product:', x + 100, yPos)
        doc.fontSize(6)
          .font('Helvetica')
          .text(asset.product_name || 'N/A', x + 130, yPos, { width: 140, ellipsis: true })

        yPos += 12

        // Serial
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text('Serial:', x + 100, yPos)
        doc.fontSize(6)
          .font('Helvetica')
          .text(asset.serial_number || 'N/A', x + 130, yPos, { width: 140, ellipsis: true })

        yPos += 12

        // Location
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text('Location:', x + 100, yPos)
        doc.fontSize(6)
          .font('Helvetica')
          .text(asset.location_name || 'N/A', x + 130, yPos, { width: 140, ellipsis: true })

        yPos += 12

        // Department
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text('Dept:', x + 100, yPos)
        doc.fontSize(6)
          .font('Helvetica')
          .text(asset.department_name || 'N/A', x + 130, yPos, { width: 140, ellipsis: true })

        yPos += 12

        // Status
        doc.fontSize(7)
          .font('Helvetica-Bold')
          .text('Status:', x + 100, yPos)
        doc.fontSize(6)
          .font('Helvetica')
          .text(asset.status ? asset.status.toUpperCase() : 'N/A', x + 130, yPos)

        // Footer
        doc.fontSize(5)
          .font('Helvetica')
          .text(`Poleplus ITSM ©️ 2026 | Generated: ${new Date().toLocaleDateString('en-GB')}`, x, y + 128, {
            width: labelWidth,
            align: 'center'
          })
      }

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

module.exports = {
  generateAssetLabelPDF,
  generateBulkAssetLabelsPDF
}
