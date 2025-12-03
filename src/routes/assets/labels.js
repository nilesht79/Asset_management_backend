/**
 * Asset Label Generation Routes
 */

const express = require('express')
const router = express.Router()
const { requireDynamicPermission, requireRole } = require('../../middleware/permissions')
const { validateUUID } = require('../../middleware/validation')
const { asyncHandler } = require('../../middleware/error-handler')
const labelService = require('../../services/labelService')
const pdfService = require('../../services/pdfService')

/**
 * GET /api/assets/:id/label
 * Generate label for a single asset
 */
router.get(
  '/:id/label',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const assetId = req.params.id

    // Get asset data
    const assetData = await labelService.getAssetLabelData(assetId)

    // Generate PDF
    const pdfBuffer = await pdfService.generateAssetLabelPDF(assetData)

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="asset-label-${assetData.asset_tag}.pdf"`)
    res.setHeader('Content-Length', pdfBuffer.length)

    res.send(pdfBuffer)
  })
)

/**
 * GET /api/assets/:id/label/preview
 * Get label data for preview (without generating PDF)
 */
router.get(
  '/:id/label/preview',
  requireDynamicPermission(),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const assetId = req.params.id

    // Get asset data
    const assetData = await labelService.getAssetLabelData(assetId)

    res.json({
      success: true,
      data: assetData
    })
  })
)

/**
 * POST /api/assets/labels/bulk
 * Generate labels for multiple selected assets
 */
router.post(
  '/labels/bulk',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const { assetIds } = req.body

    if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Asset IDs array is required'
      })
    }

    // Validate all IDs are UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const invalidIds = assetIds.filter(id => !uuidRegex.test(id))
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid asset IDs provided',
        invalidIds
      })
    }

    // Limit to reasonable number
    if (assetIds.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Cannot generate more than 1000 labels at once'
      })
    }

    // Get assets data
    const assetsData = await labelService.getMultipleAssetsLabelData(assetIds)

    if (assetsData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No assets found with provided IDs'
      })
    }

    // Generate bulk PDF
    const pdfBuffer = await pdfService.generateBulkAssetLabelsPDF(assetsData)

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="asset-labels-bulk-${Date.now()}.pdf"`)
    res.setHeader('Content-Length', pdfBuffer.length)

    res.send(pdfBuffer)
  })
)

/**
 * GET /api/assets/labels/all
 * Generate labels for all assets (with filters)
 */
router.get(
  '/labels/all',
  requireDynamicPermission(),
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status,
      category_id: req.query.category_id,
      location_id: req.query.location_id,
      assigned_to: req.query.assigned_to,
      product_id: req.query.product_id,
      oem_id: req.query.oem_id,
      search: req.query.search
    }

    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || filters[key] === '') {
        delete filters[key]
      }
    })

    // Get all assets data
    const assetsData = await labelService.getAllAssetsLabelData(filters)

    if (assetsData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No assets found matching the criteria'
      })
    }

    // Limit check
    if (assetsData.length > 2000) {
      return res.status(400).json({
        success: false,
        message: `Too many assets (${assetsData.length}). Please apply filters to reduce the count below 2000.`
      })
    }

    // Generate bulk PDF
    const pdfBuffer = await pdfService.generateBulkAssetLabelsPDF(assetsData)

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="asset-labels-all-${Date.now()}.pdf"`)
    res.setHeader('Content-Length', pdfBuffer.length)

    res.send(pdfBuffer)
  })
)

module.exports = router
