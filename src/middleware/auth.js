// Legacy JWT authentication has been replaced with OAuth 2.0
// Import OAuth authentication middleware instead
const { authenticateOAuth, optionalOAuth, requireOAuthRoles, requireOAuthSelfOrRole, requireOAuthPermissions } = require('./oauth-auth');
const { sendUnauthorized, sendForbidden } = require('../utils/response');
const authConfig = require('../config/auth');

// For backward compatibility, re-export OAuth functions with original names
const authenticateToken = authenticateOAuth;
const optionalAuth = optionalOAuth;

// Use OAuth-based role checking
const requireRoles = requireOAuthRoles;
const requireSelfOrRole = requireOAuthSelfOrRole;
const requirePermissions = requireOAuthPermissions;

// Legacy JWT token functions removed - OAuth 2.0 handles token generation
// These functions are no longer used with OAuth 2.0 implementation

module.exports = {
  authenticateToken, // Now points to OAuth authentication
  optionalAuth, // Now points to OAuth optional authentication
  requireRoles, // Now points to OAuth role checking
  requireSelfOrRole, // Now points to OAuth self/role checking
  requirePermissions, // OAuth permissions checking
  // Removed: generateAccessToken, generateRefreshToken, verifyRefreshToken
  // OAuth 2.0 server handles all token operations
};