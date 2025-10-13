// Legacy JWT login routes have been replaced with OAuth 2.0
// These routes are deprecated and should be removed
// Use OAuth login endpoints in oauth-login.js instead

const express = require('express');
const { sendError } = require('../../utils/response');

const router = express.Router();

// All JWT-based login routes have been deprecated
// Use OAuth 2.0 endpoints instead:
// POST /auth/oauth-login - General OAuth login
// POST /auth/oauth-coordinator-login - Role-specific OAuth login
// etc.

// Redirect all legacy login attempts to OAuth endpoints
const redirectToOAuth = (_, res) => {
  return sendError(res, {
    message: 'JWT authentication has been deprecated. Use OAuth 2.0 endpoints instead.',
    oauth_endpoints: {
      general_login: '/auth/oauth-login',
      coordinator_login: '/auth/oauth-coordinator-login',
      engineer_login: '/auth/oauth-engineer-login',
      department_head_login: '/auth/oauth-department-head-login',
      department_coordinator_login: '/auth/oauth-department-coordinator-login',
      admin_login: '/auth/oauth-admin-login',
      superadmin_login: '/auth/oauth-superadmin-login'
    },
    required_parameters: {
      email: 'string',
      password: 'string',
      client_id: 'string (use: asset-management-web)',
      scope: 'string (optional, default: read write)'
    }
  }, 410); // 410 Gone - Resource no longer available
};

// Deprecated routes - redirect to OAuth
router.post('/', redirectToOAuth);
router.post('/coordinator', redirectToOAuth);
router.post('/engineer', redirectToOAuth);
router.post('/department-head', redirectToOAuth);
router.post('/department-coordinator', redirectToOAuth);
router.post('/admin', redirectToOAuth);
router.post('/superadmin', redirectToOAuth);

module.exports = router;