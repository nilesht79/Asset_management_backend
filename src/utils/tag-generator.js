const { connectDB, sql } = require('../config/database');

/**
 * Generate asset tag from product name
 * Pattern: PRODUCT_CODE-SEQUENCE
 * Example: DELL-LAPTOP-001, KINGSTON-RAM-045
 *
 * @param {string} productName - The product name
 * @param {string} productId - The product UUID
 * @returns {Promise<string>} The generated asset tag
 */
async function generateAssetTag(productName, productId) {
  const pool = await connectDB();

  // Generate product code from name (e.g., "Dell Laptop E7450" -> "DELL-LAPTOP")
  const productCode = productName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]+/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .split('-')
    .slice(0, 2) // Take first 2 words max
    .join('-')
    .substring(0, 20); // Max 20 chars for product code

  // Get the next sequence number for this product
  const result = await pool.request()
    .input('productId', sql.UniqueIdentifier, productId)
    .query(`
      SELECT COUNT(*) + 1 as next_sequence
      FROM assets a
      WHERE a.product_id = @productId AND a.is_active = 1
    `);

  const sequence = result.recordset[0].next_sequence;
  const sequenceStr = sequence.toString().padStart(3, '0');

  // Generate asset_tag: PRODUCT_CODE-SEQUENCE
  const assetTag = `${productCode}-${sequenceStr}`;

  return assetTag;
}

/**
 * Check if an asset tag already exists
 * @param {string} assetTag - The asset tag to check
 * @returns {Promise<boolean>} True if exists, false otherwise
 */
async function assetTagExists(assetTag) {
  const pool = await connectDB();

  const result = await pool.request()
    .input('assetTag', sql.VarChar(50), assetTag)
    .query(`
      SELECT COUNT(*) as count
      FROM assets
      WHERE asset_tag = @assetTag AND is_active = 1
    `);

  return result.recordset[0].count > 0;
}

/**
 * Generate a unique asset tag, ensuring no duplicates
 * @param {string} productName - The product name
 * @param {string} productId - The product UUID
 * @returns {Promise<string>} The generated unique asset tag
 */
async function generateUniqueAssetTag(productName, productId) {
  let assetTag = await generateAssetTag(productName, productId);
  let attempts = 0;
  const maxAttempts = 10;

  // If tag already exists, try adding a suffix
  while (await assetTagExists(assetTag) && attempts < maxAttempts) {
    attempts++;
    const timestamp = Date.now().toString().slice(-4);
    assetTag = await generateAssetTag(productName, productId);
    assetTag = `${assetTag}-${timestamp}`;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique asset tag after multiple attempts');
  }

  return assetTag;
}

/**
 * Generate a unique tag number for an asset
 * Pattern: ASSET_TAG/ADM-LOCATION_PREFIX-SEQUENCE
 * Example: ASSET-001/ADM-D58-001
 *
 * @param {string} assetTag - The asset tag
 * @param {string} locationId - The UUID of the location (from assigned user)
 * @returns {Promise<string>} The generated tag number
 */
async function generateTagNo(assetTag, locationId) {
  const pool = await connectDB();

  // Get location prefix (first 3 chars of location ID)
  const locationPrefix = locationId ? locationId.substring(0, 3).toUpperCase() : 'ADM';

  // Get the next sequence number for this location
  // Note: Assets inherit location from assigned users, so we count assets where user.location_id matches
  const result = await pool.request()
    .input('locationId', sql.UniqueIdentifier, locationId)
    .query(`
      SELECT COUNT(*) + 1 as next_sequence
      FROM assets a
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      WHERE u.location_id = @locationId AND a.is_active = 1
    `);

  const sequence = result.recordset[0].next_sequence;
  const sequenceStr = sequence.toString().padStart(3, '0');

  // Generate tag_no: ASSET_TAG/ADM-LOCATION_PREFIX-SEQUENCE
  const tagNo = `${assetTag}/ADM-${locationPrefix}-${sequenceStr}`;

  return tagNo;
}

/**
 * Check if a tag number already exists
 * @param {string} tagNo - The tag number to check
 * @returns {Promise<boolean>} True if exists, false otherwise
 */
async function tagNoExists(tagNo) {
  const pool = await connectDB();

  const result = await pool.request()
    .input('tagNo', sql.VarChar(100), tagNo)
    .query(`
      SELECT COUNT(*) as count
      FROM assets
      WHERE tag_no = @tagNo AND is_active = 1
    `);

  return result.recordset[0].count > 0;
}

/**
 * Generate a unique tag number, ensuring no duplicates
 * @param {string} assetTag - The asset tag
 * @param {string} locationId - The UUID of the location
 * @returns {Promise<string>} The generated unique tag number
 */
async function generateUniqueTagNo(assetTag, locationId) {
  let tagNo = await generateTagNo(assetTag, locationId);
  let attempts = 0;
  const maxAttempts = 10;

  // If tag already exists, try adding a suffix
  while (await tagNoExists(tagNo) && attempts < maxAttempts) {
    attempts++;
    const timestamp = Date.now().toString().slice(-4);
    tagNo = await generateTagNo(assetTag, locationId) + `-${timestamp}`;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique tag number after multiple attempts');
  }

  return tagNo;
}

module.exports = {
  generateAssetTag,
  assetTagExists,
  generateUniqueAssetTag,
  generateTagNo,
  tagNoExists,
  generateUniqueTagNo
};
