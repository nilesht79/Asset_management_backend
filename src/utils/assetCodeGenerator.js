/**
 * Asset Code Generator Utility
 * Generates asset codes in format: CID/0/AC/BK-DT/HP/3456
 *
 * Format breakdown:
 * - ORG: Organization code (from ORG_MASTER table)
 * - SUB_ORG: Sub-organization code (from ORG_MASTER table)
 * - DEPARTMENT: 2 characters (generated from department name)
 * - LOCATION: 2 characters (generated from location name)
 * - ASSET_TYPE: 2 characters (generated from category/product)
 * - OEM: 2 characters (generated from OEM name)
 * - ASSET_NUMBER: 4 digits (last 4 digits of serial number)
 */

const { connectDB } = require('../config/database')

// Default organization codes (fallback if DB unavailable)
const DEFAULT_ORG_CODE = 'CID'
const DEFAULT_SUB_ORG_CODE = '0'

/**
 * Fetch default ORG and SUB_ORG codes from ORG_MASTER table
 * @returns {Promise<{org: string, subOrg: string}>}
 */
async function getOrgCodes() {
  try {
    const pool = await connectDB()
    const result = await pool.request()
      .query(`
        SELECT TOP 1 org_code, sub_org_code
        FROM ORG_MASTER
        WHERE is_default = 1 AND is_active = 1
      `)

    if (result.recordset.length > 0) {
      return {
        org: result.recordset[0].org_code,
        subOrg: result.recordset[0].sub_org_code
      }
    }

    // No default found, return defaults
    return {
      org: DEFAULT_ORG_CODE,
      subOrg: DEFAULT_SUB_ORG_CODE
    }
  } catch (error) {
    console.error('Error fetching org codes from ORG_MASTER:', error.message)
    // Return defaults on error
    return {
      org: DEFAULT_ORG_CODE,
      subOrg: DEFAULT_SUB_ORG_CODE
    }
  }
}

// Predefined mappings for common cases (override auto-generation)
const LOCATION_CODE_MAP = {
  'METRO LINE-2B': 'M2',
  'METRO LINE-2A': 'M1',
  'BKC OFFICE': 'BK',
  'CORPORATE HEAD OFFICE': 'HO',
  'HEAD OFFICE': 'HO',
  'ANDHERI OFFICE': 'AN',
  'MUMBAI OFFICE': 'MU',
}

const DEPARTMENT_CODE_MAP = {
  'INFORMATION TECHNOLOGY': 'IT',
  'IT DEPARTMENT': 'IT',
  'HUMAN RESOURCES': 'HR',
  'HR DEPARTMENT': 'HR',
  'FINANCE & ACCOUNTS': 'FA',
  'FINANCE AND ACCOUNTS': 'FA',
  'ACCOUNTS': 'AC',
  'OPERATIONS': 'OP',
  'SALES & MARKETING': 'SM',
  'SALES AND MARKETING': 'SM',
  'ADMINISTRATION': 'AD',
  'MAINTENANCE': 'MT',
  'SECURITY': 'SC',
}

const OEM_CODE_MAP = {
  'HEWLETT PACKARD': 'HP',
  'HEWLETT-PACKARD': 'HP',
  'DELL': 'DL',
  'LENOVO': 'LN',
  'APPLE': 'AP',
  'MICROSOFT': 'MS',
  'CISCO': 'CS',
  'SAMSUNG': 'SM',
  'LG': 'LG',
  'ASUS': 'AS',
  'ACER': 'AC',
  'EPSON': 'EP',
  'CANON': 'CN',
  'BROTHER': 'BR',
  'ZEBRA': 'ZB',
  'HONEYWELL': 'HW',
}

/**
 * Generate 2-character department code from department name
 * @param {string} departmentName - Department name
 * @returns {string} 2-character department code
 */
function generateDepartmentCode(departmentName) {
  if (!departmentName) return 'UN' // Unknown

  const normalized = departmentName.toUpperCase().trim()

  // Check predefined mappings first
  if (DEPARTMENT_CODE_MAP[normalized]) {
    return DEPARTMENT_CODE_MAP[normalized]
  }

  // Auto-generate from name
  const words = normalized.split(/[\s-_&]+/).filter(w => w.length > 0)

  if (words.length === 0) return 'UN'
  if (words.length === 1) {
    // Single word: take first 2 characters
    return words[0].substring(0, 2)
  }

  // Multiple words: take first character of first 2 words
  return words[0][0] + words[1][0]
}

/**
 * Generate 2-character location code from location name
 * @param {string} locationName - Location name
 * @returns {string} 2-character location code
 */
function generateLocationCode(locationName) {
  if (!locationName) return 'NA' // Not Available

  const normalized = locationName.toUpperCase().trim()

  // Check predefined mappings first
  if (LOCATION_CODE_MAP[normalized]) {
    return LOCATION_CODE_MAP[normalized]
  }

  // Auto-generate from name
  const words = normalized.split(/[\s-_]+/).filter(w => w.length > 0)

  if (words.length === 0) return 'NA'
  if (words.length === 1) {
    // Single word: take first 2 characters
    return words[0].substring(0, 2)
  }

  // Multiple words: take first character of first 2 words
  return words[0][0] + words[1][0]
}

/**
 * Generate 2-character OEM code from OEM name
 * @param {string} oemName - OEM/Manufacturer name
 * @returns {string} 2-character OEM code
 */
function generateOEMCode(oemName) {
  if (!oemName) return 'XX' // Unknown

  const normalized = oemName.toUpperCase().trim()

  // Check predefined mappings first
  if (OEM_CODE_MAP[normalized]) {
    return OEM_CODE_MAP[normalized]
  }

  // Auto-generate: remove non-alphabetic chars and take first 2
  const cleaned = normalized.replace(/[^A-Z]/g, '')

  if (cleaned.length === 0) return 'XX'
  if (cleaned.length === 1) return cleaned + 'X'

  return cleaned.substring(0, 2)
}

/**
 * Generate 2-character asset type code from category and product name
 * @param {string} categoryName - Asset category name
 * @param {string} productName - Product name
 * @returns {string} 2-character asset type code
 */
function generateAssetTypeCode(categoryName, productName) {
  const combined = `${categoryName || ''} ${productName || ''}`.toUpperCase()

  // Keyword matching for common asset types
  if (combined.includes('DESKTOP') || combined.includes('PC') || combined.includes('WORKSTATION')) {
    return 'DT' // Desktop
  }
  if (combined.includes('LAPTOP') || combined.includes('NOTEBOOK')) {
    return 'LT' // Laptop
  }
  if (combined.includes('PRINTER')) {
    return 'PT' // Printer
  }
  if (combined.includes('MONITOR') || combined.includes('DISPLAY') || combined.includes('SCREEN')) {
    return 'MN' // Monitor
  }
  if (combined.includes('ROUTER') || combined.includes('SWITCH') || combined.includes('NETWORK')) {
    return 'NW' // Network
  }
  if (combined.includes('SERVER')) {
    return 'SV' // Server
  }
  if (combined.includes('PHONE') || combined.includes('MOBILE')) {
    return 'PH' // Phone
  }
  if (combined.includes('TABLET')) {
    return 'TB' // Tablet
  }
  if (combined.includes('SCANNER')) {
    return 'SC' // Scanner
  }
  if (combined.includes('KEYBOARD')) {
    return 'KB' // Keyboard
  }
  if (combined.includes('MOUSE')) {
    return 'MS' // Mouse
  }
  if (combined.includes('WEBCAM') || combined.includes('CAMERA')) {
    return 'CM' // Camera
  }
  if (combined.includes('HEADSET') || combined.includes('HEADPHONE')) {
    return 'HS' // Headset
  }
  if (combined.includes('UPS') || combined.includes('POWER')) {
    return 'PS' // Power Supply
  }
  if (combined.includes('STORAGE') || combined.includes('NAS') || combined.includes('SAN')) {
    return 'ST' // Storage
  }

  return 'OT' // Other
}

/**
 * Extract 4-digit asset number from serial number
 * @param {string} serialNumber - Asset serial number
 * @returns {string} 4-digit asset number
 */
function extractAssetNumber(serialNumber) {
  if (!serialNumber) return '0000'

  // Remove all non-digit characters
  const digits = serialNumber.replace(/\D/g, '')

  // If no digits found, generate hash-based number
  if (digits.length === 0) {
    let hash = 0
    for (let i = 0; i < serialNumber.length; i++) {
      hash = ((hash << 5) - hash) + serialNumber.charCodeAt(i)
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString().slice(-4).padStart(4, '0')
  }

  // If we have digits, take last 4
  if (digits.length >= 4) {
    return digits.slice(-4)
  }

  // If less than 4 digits, pad with zeros on the left
  return digits.padStart(4, '0')
}

/**
 * Generate complete asset code (async - fetches ORG from database)
 * @param {Object} assetData - Asset data object
 * @param {string} assetData.serial_number - Serial number
 * @param {string} assetData.department_name - Department name
 * @param {string} assetData.location_name - Location name
 * @param {string} assetData.category_name - Category name
 * @param {string} assetData.product_name - Product name
 * @param {string} assetData.oem_name - OEM name
 * @returns {Promise<string>} Complete asset code (e.g., "CID/0/AC/BK-DT/HP/3456")
 */
async function generateAssetCode(assetData) {
  const { org, subOrg } = await getOrgCodes()
  const department = generateDepartmentCode(assetData.department_name)
  const location = generateLocationCode(assetData.location_name)
  const assetType = generateAssetTypeCode(assetData.category_name, assetData.product_name)
  const oem = generateOEMCode(assetData.oem_name)
  const assetNumber = extractAssetNumber(assetData.serial_number)

  // Format: CID/0/AC/BK-DT/HP/3456
  return `${org}/${subOrg}/${department}/${location}-${assetType}/${oem}/${assetNumber}`
}

/**
 * Generate asset code breakdown with individual components (async)
 * @param {Object} assetData - Asset data object
 * @returns {Promise<Object>} Asset code components
 */
async function generateAssetCodeBreakdown(assetData) {
  const { org, subOrg } = await getOrgCodes()
  const department = generateDepartmentCode(assetData.department_name)
  const location = generateLocationCode(assetData.location_name)
  const assetType = generateAssetTypeCode(assetData.category_name, assetData.product_name)
  const oem = generateOEMCode(assetData.oem_name)
  const assetNumber = extractAssetNumber(assetData.serial_number)

  return {
    org,
    subOrg,
    department,
    location,
    assetType,
    oem,
    assetNumber,
    fullCode: `${org}/${subOrg}/${department}/${location}-${assetType}/${oem}/${assetNumber}`
  }
}

module.exports = {
  generateAssetCode,
  generateAssetCodeBreakdown,
  generateDepartmentCode,
  generateLocationCode,
  generateOEMCode,
  generateAssetTypeCode,
  extractAssetNumber,
  getOrgCodes,
}
