/**
 * Label Service
 * Handles asset label data formatting and preparation
 */

const { getPool } = require('../config/database')
const { generateAssetCode, generateAssetCodeBreakdown } = require('../utils/assetCodeGenerator')

/**
 * Fetch asset data for label generation
 * @param {string} assetId - Asset UUID
 * @returns {Object} Asset data with all necessary information
 */
async function getAssetLabelData(assetId) {
  const pool = getPool()
  const query = `
    SELECT
      a.id,
      a.asset_tag,
      a.serial_number,
      a.status,
      a.condition_status,
      a.purchase_date,
      a.warranty_start_date,
      a.warranty_end_date,
      a.eol_date,
      a.eos_date,
      a.asset_type,
      p.name as product_name,
      p.model as product_model,
      c.name as category_name,
      o.name as oem_name,
      l.name as location_name,
      l.building as location_building,
      l.floor as location_floor,
      l.address as location_address,
      d.department_name,
      u.first_name as assigned_user_firstname,
      u.last_name as assigned_user_lastname,
      u.email as assigned_user_email,
      u.employee_id as assigned_user_employee_id
    FROM assets a
    LEFT JOIN products p ON a.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN oems o ON p.oem_id = o.id
    LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
    LEFT JOIN locations l ON u.location_id = l.id
    LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
    WHERE a.id = @assetId AND a.is_active = 1
  `

  const result = await pool.request()
    .input('assetId', assetId)
    .query(query)

  if (result.recordset.length === 0) {
    throw new Error('Asset not found')
  }

  const asset = result.recordset[0]

  // Generate asset code (async - fetches ORG from database)
  const assetCode = await generateAssetCode({
    serial_number: asset.serial_number,
    department_name: asset.department_name,
    location_name: asset.location_name,
    category_name: asset.category_name,
    product_name: asset.product_name,
    oem_name: asset.oem_name
  })

  // Get code breakdown (async)
  const codeBreakdown = await generateAssetCodeBreakdown({
    serial_number: asset.serial_number,
    department_name: asset.department_name,
    location_name: asset.location_name,
    category_name: asset.category_name,
    product_name: asset.product_name,
    oem_name: asset.oem_name
  })

  return {
    ...asset,
    assetCode,
    codeBreakdown,
    generatedAt: new Date().toISOString()
  }
}

/**
 * Fetch multiple assets data for bulk label generation
 * @param {Array<string>} assetIds - Array of asset UUIDs
 * @returns {Array<Object>} Array of asset data
 */
async function getMultipleAssetsLabelData(assetIds) {
  if (!assetIds || assetIds.length === 0) {
    return []
  }

  const pool = getPool()

  // Create parameterized query for multiple IDs
  const placeholders = assetIds.map((_, index) => `@assetId${index}`).join(', ')

  const query = `
    SELECT
      a.id,
      a.asset_tag,
      a.serial_number,
      a.status,
      a.condition_status,
      a.purchase_date,
      a.warranty_start_date,
      a.warranty_end_date,
      a.eol_date,
      a.eos_date,
      a.asset_type,
      p.name as product_name,
      p.model as product_model,
      c.name as category_name,
      o.name as oem_name,
      l.name as location_name,
      l.building as location_building,
      l.floor as location_floor,
      l.address as location_address,
      d.department_name,
      u.first_name as assigned_user_firstname,
      u.last_name as assigned_user_lastname,
      u.email as assigned_user_email,
      u.employee_id as assigned_user_employee_id
    FROM assets a
    LEFT JOIN products p ON a.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN oems o ON p.oem_id = o.id
    LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
    LEFT JOIN locations l ON u.location_id = l.id
    LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
    WHERE a.id IN (${placeholders}) AND a.is_active = 1
    ORDER BY a.asset_tag
  `

  const request = pool.request()
  assetIds.forEach((id, index) => {
    request.input(`assetId${index}`, id)
  })

  const result = await request.query(query)

  // Generate asset codes for all assets (async)
  const assetsWithCodes = await Promise.all(result.recordset.map(async (asset) => {
    const assetCode = await generateAssetCode({
      serial_number: asset.serial_number,
      department_name: asset.department_name,
      location_name: asset.location_name,
      category_name: asset.category_name,
      product_name: asset.product_name,
      oem_name: asset.oem_name
    })

    const codeBreakdown = await generateAssetCodeBreakdown({
      serial_number: asset.serial_number,
      department_name: asset.department_name,
      location_name: asset.location_name,
      category_name: asset.category_name,
      product_name: asset.product_name,
      oem_name: asset.oem_name
    })

    return {
      ...asset,
      assetCode,
      codeBreakdown,
      generatedAt: new Date().toISOString()
    }
  }))

  return assetsWithCodes
}

/**
 * Fetch all assets matching filters for bulk label generation
 * @param {Object} filters - Filter parameters
 * @returns {Array<Object>} Array of asset data
 */
async function getAllAssetsLabelData(filters = {}) {
  const pool = getPool()
  const whereConditions = ['a.is_active = 1']
  const request = pool.request()

  // Apply filters
  if (filters.status) {
    whereConditions.push('a.status = @status')
    request.input('status', filters.status)
  }

  if (filters.category_id) {
    whereConditions.push('p.category_id = @categoryId')
    request.input('categoryId', filters.category_id)
  }

  if (filters.location_id) {
    whereConditions.push('u.location_id = @locationId')
    request.input('locationId', filters.location_id)
  }

  if (filters.assigned_to) {
    whereConditions.push('a.assigned_to = @assignedTo')
    request.input('assignedTo', filters.assigned_to)
  }

  if (filters.product_id) {
    whereConditions.push('a.product_id = @productId')
    request.input('productId', filters.product_id)
  }

  if (filters.oem_id) {
    whereConditions.push('p.oem_id = @oemId')
    request.input('oemId', filters.oem_id)
  }

  if (filters.search) {
    whereConditions.push(`(
      a.asset_tag LIKE @search
      OR a.serial_number LIKE @search
      OR p.name LIKE @search
      OR p.model LIKE @search
    )`)
    request.input('search', `%${filters.search}%`)
  }

  const whereClause = whereConditions.join(' AND ')

  const query = `
    SELECT
      a.id,
      a.asset_tag,
      a.serial_number,
      a.status,
      a.condition_status,
      a.purchase_date,
      a.warranty_start_date,
      a.warranty_end_date,
      a.eol_date,
      a.eos_date,
      a.asset_type,
      p.name as product_name,
      p.model as product_model,
      c.name as category_name,
      o.name as oem_name,
      l.name as location_name,
      l.building as location_building,
      l.floor as location_floor,
      l.address as location_address,
      d.department_name,
      u.first_name as assigned_user_firstname,
      u.last_name as assigned_user_lastname,
      u.email as assigned_user_email,
      u.employee_id as assigned_user_employee_id
    FROM assets a
    LEFT JOIN products p ON a.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN oems o ON p.oem_id = o.id
    LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
    LEFT JOIN locations l ON u.location_id = l.id
    LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
    WHERE ${whereClause}
    ORDER BY a.asset_tag
  `

  const result = await request.query(query)

  // Generate asset codes for all assets (async)
  const assetsWithCodes = await Promise.all(result.recordset.map(async (asset) => {
    const assetCode = await generateAssetCode({
      serial_number: asset.serial_number,
      department_name: asset.department_name,
      location_name: asset.location_name,
      category_name: asset.category_name,
      product_name: asset.product_name,
      oem_name: asset.oem_name
    })

    const codeBreakdown = await generateAssetCodeBreakdown({
      serial_number: asset.serial_number,
      department_name: asset.department_name,
      location_name: asset.location_name,
      category_name: asset.category_name,
      product_name: asset.product_name,
      oem_name: asset.oem_name
    })

    return {
      ...asset,
      assetCode,
      codeBreakdown,
      generatedAt: new Date().toISOString()
    }
  }))

  return assetsWithCodes
}

module.exports = {
  getAssetLabelData,
  getMultipleAssetsLabelData,
  getAllAssetsLabelData
}
