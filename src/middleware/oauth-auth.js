const OAuth2Server = require('../oauth/server');
const { sendUnauthorized, sendForbidden } = require('../utils/response');
const authConfig = require('../config/auth');
const OAuth2Request = require('oauth2-server/lib/request');
const OAuth2Response = require('oauth2-server/lib/response');

const authenticateOAuth = async (req, res, next) => {
  try {
    // Get token from HttpOnly cookie instead of Authorization header
    const accessToken = req.cookies?.access_token;

    if (!accessToken) {
      return sendUnauthorized(res, 'Access token required');
    }

    // Create OAuth2Server Request object with token from cookie
    const oauthRequest = new OAuth2Request({
      method: req.method,
      query: req.query,
      body: req.body,
      headers: {
        ...req.headers,
        authorization: `Bearer ${accessToken}`
      }
    });

    // Create OAuth2Server Response object
    const oauthResponse = new OAuth2Response({
      body: {},
      headers: {}
    });

    const token = await OAuth2Server.authenticate(oauthRequest, oauthResponse);

    // Attach OAuth info to request
    req.oauth = {
      token: token,
      user: token.user,
      client: token.client
    };

    // Also attach user info to maintain compatibility
    req.user = {
      id: token.user.id,
      email: token.user.email,
      firstName: token.user.firstName,
      lastName: token.user.lastName,
      role: token.user.role,
      department: token.user.department,
      permissions: token.user.permissions,
      isActive: true
    };

    next();
  } catch (error) {
    console.error('OAuth authentication error:', error);

    if (error.name === 'invalid_token' || error.name === 'insufficient_scope') {
      return sendUnauthorized(res, 'Invalid or expired access token');
    }

    return sendUnauthorized(res, 'Authentication failed');
  }
};

const optionalOAuth = async (req, res, next) => {
  try {
    // Get token from HttpOnly cookie instead of Authorization header
    const accessToken = req.cookies?.access_token;

    if (!accessToken) {
      req.user = null;
      req.oauth = null;
      return next();
    }

    // Create OAuth2Server Request object with token from cookie
    const oauthRequest = new OAuth2Request({
      method: req.method,
      query: req.query,
      body: req.body,
      headers: {
        ...req.headers,
        authorization: `Bearer ${accessToken}`
      }
    });

    // Create OAuth2Server Response object
    const oauthResponse = new OAuth2Response({
      body: {},
      headers: {}
    });

    const tokenData = await OAuth2Server.authenticate(oauthRequest, oauthResponse);

    if (tokenData) {
      req.oauth = {
        token: tokenData,
        user: tokenData.user,
        client: tokenData.client
      };

      req.user = {
        id: tokenData.user.id,
        email: tokenData.user.email,
        firstName: tokenData.user.firstName,
        lastName: tokenData.user.lastName,
        role: tokenData.user.role,
        department: tokenData.user.department,
        permissions: tokenData.user.permissions,
        isActive: true
      };
    } else {
      req.user = null;
      req.oauth = null;
    }

    next();
  } catch (error) {
    req.user = null;
    req.oauth = null;
    next();
  }
};

const requireOAuthRoles = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.oauth) {
      return sendUnauthorized(res, 'Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      return sendForbidden(res, 'Insufficient permissions');
    }

    next();
  };
};

const requireOAuthScope = (requiredScopes) => {
  return (req, res, next) => {
    if (!req.oauth || !req.oauth.token) {
      return sendUnauthorized(res, 'Authentication required');
    }

    const tokenScopes = req.oauth.token.scope ? req.oauth.token.scope.split(' ') : [];
    const hasRequiredScope = requiredScopes.some(scope => tokenScopes.includes(scope));

    if (!hasRequiredScope) {
      return sendForbidden(res, 'Insufficient scope');
    }

    next();
  };
};

const requireOAuthSelfOrRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.oauth) {
      return sendUnauthorized(res, 'Authentication required');
    }

    const targetUserId = req.params.userId || req.params.id;

    // Allow if user is accessing their own data or has required role
    if (req.user.id === targetUserId || allowedRoles.includes(req.user.role)) {
      return next();
    }

    return sendForbidden(res, 'Insufficient permissions');
  };
};

const requireOAuthPermissions = (requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user || !req.oauth) {
      return sendUnauthorized(res, 'Authentication required');
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.some(permission =>
      userPermissions.includes(permission)
    );

    if (!hasPermission) {
      return sendForbidden(res, 'Insufficient permissions');
    }

    next();
  };
};

// Hybrid middleware that supports both JWT and OAuth tokens
const authenticateHybrid = async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return sendUnauthorized(res, 'Access token is required');
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return sendUnauthorized(res, 'Access token is required');
  }

  // Try OAuth first (longer tokens are likely OAuth)
  if (token.length > 50) {
    try {
      return await authenticateOAuth(req, res, next);
    } catch (error) {
      // If OAuth fails, fall back to JWT
      console.log('OAuth authentication failed, trying JWT...');
    }
  }

  // Fall back to JWT authentication
  try {
    const { authenticateToken } = require('./auth');
    return await authenticateToken(req, res, next);
  } catch (error) {
    console.error('Both OAuth and JWT authentication failed:', error);
    return sendUnauthorized(res, 'Invalid or expired access token');
  }
};

module.exports = {
  authenticateOAuth,
  optionalOAuth,
  requireOAuthRoles,
  requireOAuthScope,
  requireOAuthSelfOrRole,
  requireOAuthPermissions,
  authenticateHybrid
};