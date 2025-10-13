const { connectDB, sql } = require('../config/database');

/**
 * Find location by name (case-insensitive)
 * @param {string} locationName - Location name to search for
 * @param {Array} locations - Array of location objects to search in
 * @returns {Object|null} Location object if found, null otherwise
 */
function findLocationByName(locationName, locations = []) {
  if (!locationName) return null;

  return locations.find(
    l => l.name.toLowerCase() === locationName.toLowerCase()
  ) || null;
}

/**
 * Get location by name from database or existing array
 * Note: Unlike departments, locations are NOT auto-created because they require
 * additional mandatory fields (client_id, location_type_id, address, contact details).
 * This function only finds existing locations.
 *
 * @param {string} locationName - Name of the location
 * @param {Array} existingLocations - Array of existing locations
 * @param {Object} pool - Database connection pool (optional)
 * @returns {Promise<Object|null>} Location object if found, null otherwise
 */
async function getLocationByName(locationName, existingLocations = [], pool = null) {
  if (!locationName) return null;

  // Try to find in existing locations array first (for batch processing)
  const existingLoc = findLocationByName(locationName, existingLocations);
  if (existingLoc) {
    return existingLoc;
  }

  // If not found in array, query database
  const dbPool = pool || await connectDB();

  const result = await dbPool.request()
    .input('locationName', sql.VarChar(100), locationName.trim())
    .query(`
      SELECT id, name, address, city_name, state_name, client_id, location_type_id
      FROM locations
      WHERE LOWER(name) = LOWER(@locationName) AND is_active = 1
    `);

  if (result.recordset.length > 0) {
    const location = result.recordset[0];
    return {
      id: location.id,
      name: location.name,
      address: location.address,
      city_name: location.city_name,
      state_name: location.state_name,
      client_id: location.client_id,
      location_type_id: location.location_type_id
    };
  }

  return null;
}

/**
 * Check if a location name exists in the database
 * @param {string} locationName - Location name to check
 * @param {Object} pool - Database connection pool (optional)
 * @returns {Promise<boolean>} True if location exists, false otherwise
 */
async function locationExists(locationName, pool = null) {
  if (!locationName) return false;

  const dbPool = pool || await connectDB();

  const result = await dbPool.request()
    .input('locationName', sql.VarChar(100), locationName.trim())
    .query(`
      SELECT COUNT(*) as count
      FROM locations
      WHERE LOWER(name) = LOWER(@locationName) AND is_active = 1
    `);

  return result.recordset[0].count > 0;
}

/**
 * Validate location name and return location ID if exists
 * Used in bulk upload validation to check if location names are valid
 *
 * @param {string} locationName - Location name to validate
 * @param {Array} existingLocations - Array of existing locations
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Object with { valid: boolean, location: Object|null, error: string|null }
 */
async function validateLocationName(locationName, existingLocations = [], pool = null) {
  if (!locationName || locationName.trim() === '') {
    // Location is optional, so empty is valid
    return { valid: true, location: null, error: null };
  }

  const location = await getLocationByName(locationName, existingLocations, pool);

  if (!location) {
    return {
      valid: false,
      location: null,
      error: `Location "${locationName}" not found. Please create the location first in the Locations master data.`
    };
  }

  return { valid: true, location, error: null };
}

module.exports = {
  findLocationByName,
  getLocationByName,
  locationExists,
  validateLocationName
};
