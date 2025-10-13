const OAuth2Server = require('oauth2-server');
const OAuth2Model = require('./model');
const oauthConfig = require('../config/oauth');

class OAuth2ServerInstance {
  constructor() {
    this.model = new OAuth2Model();
    this.server = new OAuth2Server({
      model: this.model,
      accessTokenLifetime: oauthConfig.server.accessTokenLifetime,
      refreshTokenLifetime: oauthConfig.server.refreshTokenLifetime,
      authorizationCodeLifetime: oauthConfig.server.authorizationCodeLifetime,
      allowBearerTokensInQueryString: oauthConfig.server.allowBearerTokensInQueryString,
      allowEmptyState: oauthConfig.server.allowEmptyState,
      allowExtendedTokenAttributes: oauthConfig.server.allowExtendedTokenAttributes,
      requireClientAuthentication: oauthConfig.server.requireClientAuthentication
    });
  }

  // Token endpoint handler
  async token(request, response) {
    try {
      // Get user information before token generation for role-based lifetime
      let roleBasedLifetime = oauthConfig.server.accessTokenLifetime;

      // For password grant, extract user info from request
      if (request.body && request.body.grant_type === 'password') {
        const user = await this.model.getUser(request.body.username, request.body.password);
        if (user && user.role && oauthConfig.roleBasedTokenLifetime[user.role]) {
          roleBasedLifetime = oauthConfig.roleBasedTokenLifetime[user.role];
        }
      }
      // For authorization code grant, get user from code
      else if (request.body && request.body.grant_type === 'authorization_code') {
        try {
          const code = await this.model.getAuthorizationCode(request.body.code);
          if (code && code.user && code.user.role && oauthConfig.roleBasedTokenLifetime[code.user.role]) {
            roleBasedLifetime = oauthConfig.roleBasedTokenLifetime[code.user.role];
          }
        } catch (error) {
          // Silently fall back to default lifetime
        }
      }

      const token = await this.server.token(request, response, {
        accessTokenLifetime: roleBasedLifetime,
        refreshTokenLifetime: oauthConfig.server.refreshTokenLifetime
      });

      return {
        access_token: token.accessToken,
        token_type: 'Bearer',
        expires_in: roleBasedLifetime,
        refresh_token: token.refreshToken,
        scope: token.scope,
        user: {
          id: token.user.id,
          email: token.user.email,
          firstName: token.user.firstName,
          lastName: token.user.lastName,
          role: token.user.role,
          department: token.user.department,
          permissions: token.user.permissions
        }
      };
    } catch (error) {
      console.error('OAuth Token Error:', error);
      throw error;
    }
  }

  // Authorization endpoint handler
  async authorize(request, response, options = {}) {
    try {
      const code = await this.server.authorize(request, response, {
        authenticateHandler: {
          handle: async (request) => {
            // This should be called after user authentication
            // Return user object from session or request
            return request.user || null;
          }
        },
        ...options
      });

      return code;
    } catch (error) {
      console.error('OAuth Authorization Error:', error);
      throw error;
    }
  }

  // Authenticate middleware for protected routes
  async authenticate(request, response, next) {
    try {
      const token = await this.server.authenticate(request, response);

      // Attach user and client info to request
      request.oauth = {
        token: token,
        user: token.user,
        client: token.client
      };

      if (next) next();
      return token;
    } catch (error) {
      console.error('OAuth Authentication Error:', error);
      if (next) {
        const err = new Error('Invalid or expired access token');
        err.status = 401;
        err.code = 'invalid_token';
        return next(err);
      }
      throw error;
    }
  }

  // Get access token lifetime based on user role
  getAccessTokenLifetime(request) {
    // Try to get user info from various sources
    let user = null;

    if (request.body && request.body.grant_type === 'password') {
      // For password grant, we might have user info
      user = request.user;
    } else if (request.body && request.body.grant_type === 'authorization_code') {
      // For authorization code grant, user info might be available from the request
      user = request.user;
    } else if (request.oauth && request.oauth.user) {
      // For refresh token and other flows
      user = request.oauth.user;
    }

    // Apply role-based token lifetime if user and role are available
    if (user && user.role && oauthConfig.roleBasedTokenLifetime[user.role]) {
      return oauthConfig.roleBasedTokenLifetime[user.role];
    }

    return oauthConfig.server.accessTokenLifetime;
  }

  // Revoke token
  async revokeToken(token) {
    try {
      return await this.model.revokeToken({ refreshToken: token });
    } catch (error) {
      console.error('Token revocation error:', error);
      return false;
    }
  }

  // Introspect token (check if token is valid)
  async introspectToken(token) {
    try {
      const tokenData = await this.model.getAccessToken(token);

      if (!tokenData) {
        return {
          active: false
        };
      }

      return {
        active: true,
        client_id: tokenData.client.clientId,
        username: tokenData.user.email,
        scope: tokenData.scope,
        exp: Math.floor(tokenData.accessTokenExpiresAt.getTime() / 1000),
        user: {
          id: tokenData.user.id,
          email: tokenData.user.email,
          role: tokenData.user.role,
          permissions: tokenData.user.permissions
        }
      };
    } catch (error) {
      console.error('Token introspection error:', error);
      return {
        active: false
      };
    }
  }

  // Get server instance
  getServer() {
    return this.server;
  }

  // Get model instance
  getModel() {
    return this.model;
  }
}

// Export singleton instance
module.exports = new OAuth2ServerInstance();