const express = require('express');
const OAuth2Server = require('../../oauth/server');
const OAuth2ClientManager = require('../../oauth/clients');
const { authenticateToken, requireRoles } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendUnauthorized, sendValidationError } = require('../../utils/response');
const { validateBody } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const authConfig = require('../../config/auth');

const router = express.Router();

// OAuth 2.0 Authorization endpoint
router.get('/authorize',
  asyncHandler(async (req, res) => {
    try {
      const { response_type, client_id, redirect_uri, scope, state } = req.query;

      // Basic validation
      if (!response_type || !client_id || !redirect_uri) {
        return sendValidationError(res, 'Missing required parameters: response_type, client_id, redirect_uri');
      }

      if (response_type !== 'code') {
        return sendValidationError(res, 'Unsupported response type. Only "code" is supported.');
      }

      // Verify client exists
      const client = await OAuth2ClientManager.getClient(client_id);
      if (!client) {
        return sendError(res, 'Invalid client_id', 400);
      }

      // Verify redirect URI
      if (!client.redirectUris.includes(redirect_uri)) {
        return sendError(res, 'Invalid redirect_uri', 400);
      }

      // For demonstration, we'll assume user is already authenticated
      // In a real implementation, you would redirect to login page if not authenticated
      if (!req.session || !req.session.user) {
        // Redirect to login with return URL
        const loginUrl = `/auth/login?return_url=${encodeURIComponent(req.originalUrl)}`;
        return res.redirect(loginUrl);
      }

      // User is authenticated, generate authorization code
      const request = {
        method: 'GET',
        query: req.query,
        headers: req.headers,
        user: req.session.user
      };

      const response = {
        redirect: (url) => res.redirect(url)
      };

      const code = await OAuth2Server.authorize(request, response, {
        authenticateHandler: {
          handle: async () => req.session.user
        }
      });

      // Redirect back to client with authorization code
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', code.authorizationCode);
      if (state) redirectUrl.searchParams.set('state', state);

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('Authorization endpoint error:', error);

      if (error.name === 'invalid_request' || error.name === 'unsupported_response_type') {
        return sendValidationError(res, error.message);
      }

      if (redirect_uri) {
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('error', 'server_error');
        redirectUrl.searchParams.set('error_description', 'Internal server error');
        if (state) redirectUrl.searchParams.set('state', state);
        return res.redirect(redirectUrl.toString());
      }

      return sendError(res, 'Authorization server error', 500);
    }
  })
);

// OAuth 2.0 Token endpoint
router.post('/token',
  asyncHandler(async (req, res) => {
    try {
      const request = {
        method: 'POST',
        body: req.body,
        headers: req.headers
      };

      const response = {
        body: {},
        status: 200,
        set: (key, value) => {
          res.set(key, value);
        }
      };

      const token = await OAuth2Server.token(request, response);

      // Send token response
      res.status(200).json(token);
    } catch (error) {
      console.error('Token endpoint error:', error);

      let statusCode = 400;
      let errorCode = 'invalid_request';
      let errorDescription = error.message;

      if (error.name === 'invalid_client') {
        statusCode = 401;
        errorCode = 'invalid_client';
        errorDescription = 'Client authentication failed';
      } else if (error.name === 'invalid_grant') {
        errorCode = 'invalid_grant';
        errorDescription = 'The provided authorization grant is invalid';
      } else if (error.name === 'unsupported_grant_type') {
        errorCode = 'unsupported_grant_type';
        errorDescription = 'The authorization grant type is not supported';
      }

      res.status(statusCode).json({
        error: errorCode,
        error_description: errorDescription
      });
    }
  })
);

// Token introspection endpoint (RFC 7662)
router.post('/introspect',
  asyncHandler(async (req, res) => {
    const { token, token_type_hint } = req.body;

    if (!token) {
      return sendValidationError(res, 'token parameter is required');
    }

    try {
      const introspection = await OAuth2Server.introspectToken(token);
      res.json(introspection);
    } catch (error) {
      console.error('Token introspection error:', error);
      res.json({ active: false });
    }
  })
);

// Token revocation endpoint (RFC 7009)
router.post('/revoke',
  asyncHandler(async (req, res) => {
    const { token, token_type_hint } = req.body;

    if (!token) {
      return sendValidationError(res, 'token parameter is required');
    }

    try {
      const revoked = await OAuth2Server.revokeToken(token);
      if (revoked) {
        res.status(200).json({ message: 'Token revoked successfully' });
      } else {
        res.status(200).json({ message: 'Token not found or already revoked' });
      }
    } catch (error) {
      console.error('Token revocation error:', error);
      sendError(res, 'Token revocation failed', 500);
    }
  })
);

// Client management endpoints (admin only)
router.post('/clients',
  authenticateToken,
  requireRoles([authConfig.roles.SUPERADMIN]),
  validateBody({
    clientId: { required: true, type: 'string', min: 3, max: 100 },
    clientSecret: { required: true, type: 'string', min: 8 },
    name: { required: true, type: 'string', min: 3, max: 200 },
    grants: { required: false, type: 'string', default: 'authorization_code,refresh_token' },
    redirectUris: { required: false, type: 'string' },
    scope: { required: false, type: 'string', default: 'read' },
    isConfidential: { required: false, type: 'boolean', default: true }
  }),
  asyncHandler(async (req, res) => {
    try {
      const client = await OAuth2ClientManager.registerClient(req.body);
      sendSuccess(res, client, 'OAuth client registered successfully');
    } catch (error) {
      if (error.message.includes('already exists')) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  })
);

router.get('/clients',
  authenticateToken,
  requireRoles([authConfig.roles.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await OAuth2ClientManager.listClients(page, limit);
    sendSuccess(res, result, 'Clients retrieved successfully');
  })
);

router.get('/clients/:clientId',
  authenticateToken,
  requireRoles([authConfig.roles.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const client = await OAuth2ClientManager.getClient(req.params.clientId);
    if (!client) {
      return sendError(res, 'Client not found', 404);
    }
    sendSuccess(res, client, 'Client retrieved successfully');
  })
);

router.put('/clients/:clientId',
  authenticateToken,
  requireRoles([authConfig.roles.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    try {
      const client = await OAuth2ClientManager.updateClient(req.params.clientId, req.body);
      sendSuccess(res, client, 'Client updated successfully');
    } catch (error) {
      if (error.message === 'Client not found') {
        return sendError(res, error.message, 404);
      }
      throw error;
    }
  })
);

router.delete('/clients/:clientId',
  authenticateToken,
  requireRoles([authConfig.roles.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    try {
      await OAuth2ClientManager.deleteClient(req.params.clientId);
      sendSuccess(res, null, 'Client deleted successfully');
    } catch (error) {
      if (error.message === 'Client not found') {
        return sendError(res, error.message, 404);
      }
      throw error;
    }
  })
);

router.post('/clients/:clientId/regenerate-secret',
  authenticateToken,
  requireRoles([authConfig.roles.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    try {
      const result = await OAuth2ClientManager.regenerateClientSecret(req.params.clientId);
      sendSuccess(res, result, 'Client secret regenerated successfully');
    } catch (error) {
      if (error.message.includes('not found')) {
        return sendError(res, error.message, 404);
      }
      throw error;
    }
  })
);

module.exports = router;