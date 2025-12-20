const { connectDB, sql } = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const authConfig = require('../config/auth');
const oauthConfig = require('../config/oauth');

class OAuth2Model {
  async getClient(clientId, clientSecret) {
    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          SELECT client_id, client_secret, name, grants, redirect_uris, scope, is_confidential
          FROM oauth_clients
          WHERE client_id = @clientId AND is_active = 1
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const client = result.recordset[0];

      // If client secret is provided, verify it
      if (clientSecret && !await bcrypt.compare(clientSecret, client.client_secret)) {
        return null;
      }

      return {
        id: client.client_id,
        clientId: client.client_id,
        clientSecret: client.client_secret,
        name: client.name,
        grants: client.grants.split(',').map(g => g.trim()),
        redirectUris: client.redirect_uris ? client.redirect_uris.split(',').map(u => u.trim()) : [],
        scope: client.scope,
        isConfidential: client.is_confidential
      };
    } catch (error) {
      console.error('Error getting client:', error);
      throw error;
    }
  }

  async getUser(username, password) {
    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('email', sql.VarChar(255), username.toLowerCase())
        .query(`
          SELECT u.user_id, u.email, u.password_hash, u.first_name, u.last_name, u.role,
                 u.is_active, u.failed_login_attempts, u.account_locked_until,
                 u.employee_id,
                 d.department_name, d.department_id,
                 l.name as location_name, l.id as location_id
          FROM USER_MASTER u
          LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
          LEFT JOIN locations l ON u.location_id = l.id
          WHERE u.email = @email
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const user = result.recordset[0];

      // Check if user is active
      if (!user.is_active) {
        return null;
      }

      // Check if account is locked
      if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
        return null;
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        // Update failed login attempts
        const failedAttempts = (user.failed_login_attempts || 0) + 1;
        const maxAttempts = authConfig.password.maxAttempts;

        let lockUntil = null;
        if (failedAttempts >= maxAttempts) {
          lockUntil = new Date(Date.now() + authConfig.password.lockoutDuration);
        }

        await pool.request()
          .input('userId', sql.UniqueIdentifier, user.user_id)
          .input('failedAttempts', sql.Int, failedAttempts)
          .input('lockUntil', sql.DateTime2, lockUntil)
          .query(`
            UPDATE USER_MASTER
            SET failed_login_attempts = @failedAttempts,
                account_locked_until = @lockUntil,
                updated_at = GETUTCDATE()
            WHERE user_id = @userId
          `);

        return null;
      }

      // Reset failed login attempts on successful authentication
      await pool.request()
        .input('userId', sql.UniqueIdentifier, user.user_id)
        .query(`
          UPDATE USER_MASTER
          SET failed_login_attempts = 0,
              account_locked_until = NULL,
              last_login = GETUTCDATE(),
              updated_at = GETUTCDATE()
          WHERE user_id = @userId
        `);

      return {
        id: user.user_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        employeeId: user.employee_id,
        department: {
          id: user.department_id,
          name: user.department_name
        },
        location: {
          id: user.location_id,
          name: user.location_name
        },
        permissions: authConfig.ROLE_PERMISSIONS[user.role] || []
      };
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    }
  }

  async saveToken(token, client, user) {
    const pool = await connectDB();

    try {
      // Calculate role-based access token expiry if not already set
      if (!token.accessTokenExpiresAt && user && user.role) {
        const roleBasedLifetime = oauthConfig.roleBasedTokenLifetime[user.role] || oauthConfig.server.accessTokenLifetime;
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + roleBasedLifetime);
        token.accessTokenExpiresAt = expiresAt;
      }

      // Save access token
      const accessTokenId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, accessTokenId)
        .input('token', sql.VarChar(500), token.accessToken)
        .input('clientId', sql.VarChar(100), client.clientId)
        .input('userId', sql.UniqueIdentifier, user.id)
        .input('scope', sql.VarChar(500), token.scope || 'read')
        .input('expiresAt', sql.DateTime2, token.accessTokenExpiresAt)
        .query(`
          INSERT INTO oauth_access_tokens
          (id, token, client_id, user_id, scope, expires_at)
          VALUES (@id, @token, @clientId, @userId, @scope, @expiresAt)
        `);

      // Save refresh token if present
      if (token.refreshToken) {
        await pool.request()
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('token', sql.VarChar(500), token.refreshToken)
          .input('accessTokenId', sql.UniqueIdentifier, accessTokenId)
          .input('clientId', sql.VarChar(100), client.clientId)
          .input('userId', sql.UniqueIdentifier, user.id)
          .input('scope', sql.VarChar(500), token.scope || 'read')
          .input('expiresAt', sql.DateTime2, token.refreshTokenExpiresAt)
          .query(`
            INSERT INTO oauth_refresh_tokens
            (id, token, access_token_id, client_id, user_id, scope, expires_at)
            VALUES (@id, @token, @accessTokenId, @clientId, @userId, @scope, @expiresAt)
          `);
      }

      return {
        accessToken: token.accessToken,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshToken: token.refreshToken,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        scope: token.scope,
        client: client,
        user: user
      };
    } catch (error) {
      console.error('Error saving token:', error);
      throw error;
    }
  }

  async getAccessToken(accessToken) {
    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('token', sql.VarChar(500), accessToken)
        .query(`
          SELECT at.token, at.scope, at.expires_at, at.client_id, at.user_id,
                 u.email, u.first_name, u.last_name, u.role,
                 c.name as client_name, c.grants
          FROM oauth_access_tokens at
          INNER JOIN USER_MASTER u ON at.user_id = u.user_id
          INNER JOIN oauth_clients c ON at.client_id = c.client_id
          WHERE at.token = @token AND at.is_revoked = 0 AND at.expires_at > GETUTCDATE()
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const tokenData = result.recordset[0];

      return {
        accessToken: tokenData.token,
        accessTokenExpiresAt: tokenData.expires_at,
        scope: tokenData.scope,
        client: {
          id: tokenData.client_id,
          clientId: tokenData.client_id,
          name: tokenData.client_name,
          grants: tokenData.grants.split(',').map(g => g.trim())
        },
        user: {
          id: tokenData.user_id,
          email: tokenData.email,
          firstName: tokenData.first_name,
          lastName: tokenData.last_name,
          role: tokenData.role,
          permissions: authConfig.ROLE_PERMISSIONS[tokenData.role] || []
        }
      };
    } catch (error) {
      console.error('Error getting access token:', error);
      throw error;
    }
  }

  async getRefreshToken(refreshToken) {
    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('token', sql.VarChar(500), refreshToken)
        .query(`
          SELECT rt.token, rt.scope, rt.expires_at, rt.client_id, rt.user_id,
                 u.email, u.first_name, u.last_name, u.role,
                 c.name as client_name, c.grants
          FROM oauth_refresh_tokens rt
          INNER JOIN USER_MASTER u ON rt.user_id = u.user_id
          INNER JOIN oauth_clients c ON rt.client_id = c.client_id
          WHERE rt.token = @token AND rt.is_revoked = 0 AND rt.expires_at > GETUTCDATE()
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const tokenData = result.recordset[0];

      return {
        refreshToken: tokenData.token,
        refreshTokenExpiresAt: tokenData.expires_at,
        scope: tokenData.scope,
        client: {
          id: tokenData.client_id,
          clientId: tokenData.client_id,
          name: tokenData.client_name,
          grants: tokenData.grants.split(',').map(g => g.trim())
        },
        user: {
          id: tokenData.user_id,
          email: tokenData.email,
          firstName: tokenData.first_name,
          lastName: tokenData.last_name,
          role: tokenData.role,
          permissions: authConfig.ROLE_PERMISSIONS[tokenData.role] || []
        }
      };
    } catch (error) {
      console.error('Error getting refresh token:', error);
      throw error;
    }
  }

  async revokeToken(token) {
    const pool = await connectDB();

    try {
      // Try to revoke as refresh token first
      let result = await pool.request()
        .input('token', sql.VarChar(500), token.refreshToken)
        .query(`
          UPDATE oauth_refresh_tokens
          SET is_revoked = 1
          WHERE token = @token
        `);

      if (result.rowsAffected[0] === 0) {
        // If not found as refresh token, try as access token
        await pool.request()
          .input('token', sql.VarChar(500), token.refreshToken)
          .query(`
            UPDATE oauth_access_tokens
            SET is_revoked = 1
            WHERE token = @token
          `);
      }

      return true;
    } catch (error) {
      console.error('Error revoking token:', error);
      return false;
    }
  }

  async saveAuthorizationCode(code, client, user) {
    const pool = await connectDB();

    try {
      await pool.request()
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('code', sql.VarChar(255), code.authorizationCode)
        .input('clientId', sql.VarChar(100), client.clientId)
        .input('userId', sql.UniqueIdentifier, user.id)
        .input('redirectUri', sql.VarChar(500), code.redirectUri)
        .input('scope', sql.VarChar(500), code.scope || 'read')
        .input('expiresAt', sql.DateTime2, code.expiresAt)
        .input('codeChallenge', sql.VarChar(128), code.codeChallenge || null)
        .input('codeChallengeMethod', sql.VarChar(10), code.codeChallengeMethod || 'S256')
        .query(`
          INSERT INTO oauth_authorization_codes
          (id, code, client_id, user_id, redirect_uri, scope, expires_at, code_challenge, code_challenge_method)
          VALUES (@id, @code, @clientId, @userId, @redirectUri, @scope, @expiresAt, @codeChallenge, @codeChallengeMethod)
        `);

      return {
        authorizationCode: code.authorizationCode,
        expiresAt: code.expiresAt,
        redirectUri: code.redirectUri,
        scope: code.scope,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        client: client,
        user: user
      };
    } catch (error) {
      console.error('Error saving authorization code:', error);
      throw error;
    }
  }

  async getAuthorizationCode(authorizationCode) {
    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('code', sql.VarChar(255), authorizationCode)
        .query(`
          SELECT ac.code, ac.redirect_uri, ac.scope, ac.expires_at, ac.client_id, ac.user_id,
                 ac.code_challenge, ac.code_challenge_method,
                 u.email, u.first_name, u.last_name, u.role,
                 c.name as client_name, c.grants, c.redirect_uris
          FROM oauth_authorization_codes ac
          INNER JOIN USER_MASTER u ON ac.user_id = u.user_id
          INNER JOIN oauth_clients c ON ac.client_id = c.client_id
          WHERE ac.code = @code AND ac.is_used = 0 AND ac.expires_at > GETUTCDATE()
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const codeData = result.recordset[0];

      return {
        authorizationCode: codeData.code,
        expiresAt: codeData.expires_at,
        redirectUri: codeData.redirect_uri,
        scope: codeData.scope,
        codeChallenge: codeData.code_challenge,
        codeChallengeMethod: codeData.code_challenge_method,
        client: {
          id: codeData.client_id,
          clientId: codeData.client_id,
          name: codeData.client_name,
          grants: codeData.grants.split(',').map(g => g.trim()),
          redirectUris: codeData.redirect_uris ? codeData.redirect_uris.split(',').map(u => u.trim()) : []
        },
        user: {
          id: codeData.user_id,
          email: codeData.email,
          firstName: codeData.first_name,
          lastName: codeData.last_name,
          role: codeData.role,
          permissions: authConfig.ROLE_PERMISSIONS[codeData.role] || []
        }
      };
    } catch (error) {
      console.error('Error getting authorization code:', error);
      throw error;
    }
  }

  async revokeAuthorizationCode(code) {
    const pool = await connectDB();

    try {
      await pool.request()
        .input('code', sql.VarChar(255), code.authorizationCode)
        .query(`
          UPDATE oauth_authorization_codes
          SET is_used = 1
          WHERE code = @code
        `);

      return true;
    } catch (error) {
      console.error('Error revoking authorization code:', error);
      return false;
    }
  }

  async verifyScope(user, client, scope) {
    // Basic scope validation - can be enhanced based on requirements
    const requestedScopes = scope ? scope.split(' ') : ['read'];
    const clientScopes = client.scope.split(' ');

    // Check if all requested scopes are allowed for the client
    return requestedScopes.every(s => clientScopes.includes(s));
  }

  async generateAccessToken(client, user, scope) {
    // Generate a UUID-based access token
    return uuidv4().replace(/-/g, '');
  }

  async generateRefreshToken(client, user, scope) {
    // Generate a UUID-based refresh token
    return uuidv4().replace(/-/g, '');
  }

  async generateAuthorizationCode(client, user, scope) {
    // Generate a UUID-based authorization code
    return uuidv4().replace(/-/g, '');
  }

  // PKCE verification method
  verifyCodeChallenge(codeVerifier, codeChallenge, codeChallengeMethod = 'S256') {
    if (!codeChallenge || !codeVerifier) {
      return false;
    }

    try {
      if (codeChallengeMethod === 'S256') {
        // SHA256 hash of code_verifier, then base64url encode
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        const expectedChallenge = hash.toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');

        return expectedChallenge === codeChallenge;
      } else if (codeChallengeMethod === 'plain') {
        // Plain text comparison (less secure, not recommended)
        return codeVerifier === codeChallenge;
      }

      return false;
    } catch (error) {
      console.error('PKCE verification error:', error);
      return false;
    }
  }
}

module.exports = OAuth2Model;