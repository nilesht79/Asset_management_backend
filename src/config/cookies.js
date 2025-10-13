/**
 * Cookie Security Configuration
 *
 * This module centralizes cookie security settings for authentication tokens.
 * It ensures consistent, secure cookie settings across all authentication endpoints.
 */

/**
 * Get secure cookie options for authentication tokens
 * @param {string} type - 'access' or 'refresh'
 * @param {number} maxAge - Cookie expiration in milliseconds
 * @returns {Object} Cookie options object
 */
function getSecureCookieOptions(type = 'access', maxAge = 3600000) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Base security configuration
  const baseOptions = {
    httpOnly: true,       // Prevent XSS attacks by making cookies inaccessible to JavaScript
    secure: isProduction, // Secure in production, allow HTTP in development for localhost
    sameSite: 'strict',   // Strict CSRF protection
    path: '/',           // Cookie available on all paths
    domain: process.env.COOKIE_DOMAIN || undefined, // Set domain if specified in env
  };

  // Set appropriate expiration
  if (maxAge) {
    baseOptions.maxAge = maxAge;
  }

  // Add production-specific security enhancements
  if (isProduction) {
    // Could add additional security headers or configurations here
    // For now, the base configuration is already very secure
  }

  return baseOptions;
}

/**
 * Get cookie options for access tokens
 * @param {number} expiresIn - Token expiration in seconds (from OAuth response)
 * @returns {Object} Cookie options for access token
 */
function getAccessTokenCookieOptions(expiresIn = 3600) {
  const maxAge = expiresIn * 1000; // Convert to milliseconds
  return getSecureCookieOptions('access', maxAge);
}

/**
 * Get cookie options for refresh tokens
 * @param {number} expiresIn - Token expiration in seconds (default 30 days)
 * @returns {Object} Cookie options for refresh token
 */
function getRefreshTokenCookieOptions(expiresIn = 30 * 24 * 60 * 60) {
  const maxAge = expiresIn * 1000; // Convert to milliseconds
  return getSecureCookieOptions('refresh', maxAge);
}

/**
 * Get cookie options for clearing cookies (must match original settings)
 * @returns {Object} Cookie options for clearing auth cookies
 */
function getClearCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction, // Must match the secure setting used when setting cookies
    sameSite: 'strict',   // Must match the sameSite setting used when setting cookies
    path: '/',           // Must match the path used when setting cookies
    domain: process.env.COOKIE_DOMAIN || undefined, // Must match domain if set
  };
}

/**
 * Validate cookie security settings
 * Logs warnings if insecure configurations are detected
 */
function validateCookieSettings() {
  const warnings = [];
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    console.log('🔒 Production mode: Cookies will require HTTPS (secure: true)');

    if (!process.env.COOKIE_DOMAIN) {
      warnings.push('⚠️  COOKIE_DOMAIN not set in production. Consider setting it for better security.');
    }
  } else {
    console.log('🔧 Development mode: Cookies will work over HTTP (secure: false)');
    console.log('ℹ️  In production, cookies will automatically require HTTPS');
  }

  if (warnings.length > 0) {
    warnings.forEach(warning => console.warn(warning));
  }

  return warnings.length === 0;
}

module.exports = {
  getSecureCookieOptions,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  getClearCookieOptions,
  validateCookieSettings
};