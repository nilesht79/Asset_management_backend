const { connectDB, sql } = require('../config/database');

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
  generateTagNo,
  tagNoExists,
  generateUniqueTagNo
};
