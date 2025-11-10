/**
 * User Helper Utilities
 * Provides safe and consistent user name handling across the application
 */

/**
 * Safely get user's full name from request user object
 * Falls back to database query if needed to ensure data quality
 *
 * @param {object} user - Request user object (req.user)
 * @param {object} pool - Database connection pool (optional, for fallback query)
 * @returns {Promise<string>} Full name or 'System'
 */
async function getUserFullName(user, pool = null) {
  if (!user) {
    return 'System';
  }

  // Try to get name from user object (supports both camelCase and snake_case)
  const firstName = user.firstName || user.first_name;
  const lastName = user.lastName || user.last_name;

  // Validate that we have proper string values
  if (firstName && lastName &&
      firstName !== 'undefined' && lastName !== 'undefined' &&
      typeof firstName === 'string' && typeof lastName === 'string' &&
      firstName.trim().length > 0 && lastName.trim().length > 0) {
    return `${firstName} ${lastName}`.trim();
  }

  // Fallback: query database if pool is provided and user_id exists
  if (pool && user.user_id) {
    try {
      const result = await pool.request()
        .input('userId', user.user_id)
        .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @userId');

      if (result.recordset.length > 0) {
        const dbUser = result.recordset[0];
        if (dbUser.first_name && dbUser.last_name) {
          return `${dbUser.first_name} ${dbUser.last_name}`.trim();
        }
      }
    } catch (error) {
      console.error('Error fetching user name from database:', error);
      // Fall through to return 'System'
    }
  }

  // Ultimate fallback
  console.warn('Unable to determine user name, using System. User object:', {
    user_id: user.user_id,
    firstName: user.firstName,
    first_name: user.first_name,
    lastName: user.lastName,
    last_name: user.last_name
  });

  return 'System';
}

/**
 * Get user ID from request user object
 * Handles different possible property names
 *
 * @param {object} user - Request user object (req.user)
 * @returns {string|null} User ID or null
 */
function getUserId(user) {
  if (!user) {
    return null;
  }

  return user.user_id || user.userId || user.id || null;
}

/**
 * Validate that a user name doesn't contain invalid values
 * Used to prevent data quality issues before database insertion
 *
 * @param {string} userName - User name to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidUserName(userName) {
  if (!userName || typeof userName !== 'string') {
    return false;
  }

  const trimmed = userName.trim();

  // Check for empty string
  if (trimmed.length === 0) {
    return false;
  }

  // Check for 'undefined' in the string
  if (trimmed.includes('undefined')) {
    return false;
  }

  // Check for 'null' in the string
  if (trimmed.toLowerCase().includes('null')) {
    return false;
  }

  return true;
}

/**
 * Get user full name and ID from request user object
 * Returns both values in one call for convenience
 *
 * @param {object} user - Request user object (req.user)
 * @param {object} pool - Database connection pool (optional)
 * @returns {Promise<object>} Object with userId and userName properties
 */
async function getUserInfo(user, pool = null) {
  const userId = getUserId(user);
  const userName = await getUserFullName(user, pool);

  return {
    userId,
    userName
  };
}

module.exports = {
  getUserFullName,
  getUserId,
  isValidUserName,
  getUserInfo
};
