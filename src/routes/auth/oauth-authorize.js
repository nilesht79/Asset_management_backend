const express = require('express');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendUnauthorized } = require('../../utils/response');
const OAuth2Server = require('../../oauth/server');
const OAuth2Request = require('oauth2-server/lib/request');
const OAuth2Response = require('oauth2-server/lib/response');
const crypto = require('crypto');
const { getAccessTokenCookieOptions, getRefreshTokenCookieOptions } = require('../../config/cookies');

const router = express.Router();

// OAuth 2.0 Authorization endpoint
router.get('/authorize', asyncHandler(async (req, res) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
    code_challenge_method = 'S256'
  } = req.query;

  // Validate required parameters
  if (!response_type || !client_id || !redirect_uri) {
    return sendError(res, 'Missing required OAuth parameters', 400);
  }

  if (response_type !== 'code') {
    return sendError(res, 'Unsupported response_type. Only "code" is supported.', 400);
  }

  // PKCE validation
  if (!code_challenge) {
    return sendError(res, 'code_challenge is required for security', 400);
  }

  try {
    // Verify client exists and redirect URI is valid
    const OAuth2Model = require('../../oauth/model');
    const model = new OAuth2Model();
    const client = await model.getClient(client_id);

    if (!client) {
      return sendError(res, 'Invalid client_id', 400);
    }

    if (!client.redirectUris.includes(redirect_uri)) {
      return sendError(res, 'Invalid redirect_uri', 400);
    }

    // Store authorization request in session
    if (!req.session) {
      req.session = {};
    }

    req.session.oauth_request = {
      client_id,
      redirect_uri,
      scope: scope || 'read',
      state,
      code_challenge,
      code_challenge_method,
      timestamp: Date.now()
    };

    // Render login page or redirect to login
    res.render('oauth-login', {
      client_id,
      redirect_uri,
      scope: scope || 'read',
      state
    });

  } catch (error) {
    console.error('OAuth authorization error:', error);
    return sendError(res, 'Authorization request failed', 500);
  }
}));

// OAuth 2.0 User Consent/Login endpoint
router.post('/authorize', asyncHandler(async (req, res) => {
  const { email, password, consent } = req.body;
  const oauthRequest = req.session?.oauth_request;

  if (!oauthRequest) {
    return sendError(res, 'Invalid or expired authorization request', 400);
  }

  if (!email || !password) {
    return sendError(res, 'Email and password are required', 400);
  }

  try {
    const OAuth2Model = require('../../oauth/model');
    const model = new OAuth2Model();

    // Authenticate user
    const user = await model.getUser(email, password);
    if (!user) {
      return sendUnauthorized(res, 'Invalid credentials');
    }

    // Get client
    const client = await model.getClient(oauthRequest.client_id);

    // Generate authorization code
    const authCode = {
      authorizationCode: crypto.randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      redirectUri: oauthRequest.redirect_uri,
      scope: oauthRequest.scope,
      codeChallenge: oauthRequest.code_challenge,
      codeChallengeMethod: oauthRequest.code_challenge_method
    };

    // Save authorization code
    await model.saveAuthorizationCode(authCode, client, user);

    // Clear session
    delete req.session.oauth_request;

    // Redirect back to client with authorization code
    const redirectUrl = new URL(oauthRequest.redirect_uri);
    redirectUrl.searchParams.set('code', authCode.authorizationCode);
    if (oauthRequest.state) {
      redirectUrl.searchParams.set('state', oauthRequest.state);
    }

    res.redirect(redirectUrl.toString());

  } catch (error) {
    console.error('OAuth authorization error:', error);
    return sendError(res, 'Authorization failed', 500);
  }
}));

// OAuth 2.0 Token Exchange endpoint (Authorization Code -> Access Token)
router.post('/token', asyncHandler(async (req, res) => {
  try {
    const oauthRequest = new OAuth2Request({
      body: req.body,
      headers: req.headers,
      method: 'POST',
      query: req.query
    });

    const oauthResponse = new OAuth2Response({
      body: {},
      headers: {}
    });

    // Handle PKCE verification in the token exchange
    const tokenResponse = await OAuth2Server.token(oauthRequest, oauthResponse);

    // Set secure HttpOnly cookies instead of returning tokens in JSON
    const accessCookieOptions = getAccessTokenCookieOptions(tokenResponse.expires_in);
    const refreshCookieOptions = getRefreshTokenCookieOptions(); // Default 30 days

    res.cookie('access_token', tokenResponse.access_token, accessCookieOptions);
    res.cookie('refresh_token', tokenResponse.refresh_token, refreshCookieOptions);

    // Return only user info, not tokens
    return sendSuccess(res, {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      scope: tokenResponse.scope,
      user: {
        id: tokenResponse.user.id,
        email: tokenResponse.user.email,
        firstName: tokenResponse.user.firstName,
        lastName: tokenResponse.user.lastName,
        role: tokenResponse.user.role,
        department: tokenResponse.user.department,
        permissions: tokenResponse.user.permissions
      }
    }, 'Token exchange successful');

  } catch (error) {
    console.error('OAuth token exchange error:', error);

    if (error.name === 'invalid_grant') {
      return sendUnauthorized(res, 'Invalid authorization code');
    } else if (error.name === 'invalid_client') {
      return sendUnauthorized(res, 'Invalid client credentials');
    }

    return sendError(res, 'Token exchange failed', 500);
  }
}));

module.exports = router;