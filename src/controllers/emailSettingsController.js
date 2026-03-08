/**
 * EMAIL SETTINGS CONTROLLER
 * Handles email configuration management for superadmin
 * Supports Gmail, SMTP, and Microsoft 365 (OAuth 2.0 + Graph API)
 */

const axios = require('axios');
const emailService = require('../services/emailService');
const { connectDB, sql } = require('../config/database');

const EmailSettingsController = {
  /**
   * Get email configuration
   * GET /api/v1/settings/email
   */
  async getConfiguration(req, res) {
    try {
      const config = await emailService.getConfiguration();

      if (!config) {
        return res.json({
          success: true,
          data: {
            config: null,
            message: 'No email configuration found'
          }
        });
      }

      // Hide sensitive data
      const safeConfig = {
        config_id: config.config_id,
        provider: config.provider,
        smtp_host: config.smtp_host,
        smtp_port: config.smtp_port,
        smtp_secure: config.smtp_secure,
        smtp_user: config.smtp_user,
        smtp_password_set: !!config.smtp_password,
        gmail_user: config.gmail_user,
        gmail_app_password_set: !!config.gmail_app_password,
        from_email: config.from_email,
        from_name: config.from_name,
        is_enabled: config.is_enabled,
        test_email_sent_at: config.test_email_sent_at,
        test_email_status: config.test_email_status,
        updated_at: config.updated_at,
        // Microsoft fields
        microsoft_client_id: config.microsoft_client_id,
        microsoft_client_secret_set: !!config.microsoft_client_secret,
        microsoft_tenant_id: config.microsoft_tenant_id,
        microsoft_user_email: config.microsoft_user_email,
        microsoft_display_name: config.microsoft_display_name,
        microsoft_is_authenticated: !!config.microsoft_is_authenticated
      };

      res.json({
        success: true,
        data: {
          config: safeConfig
        }
      });
    } catch (error) {
      console.error('Error getting email configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get email configuration',
        error: error.message
      });
    }
  },

  /**
   * Save email configuration
   * POST /api/v1/settings/email
   */
  async saveConfiguration(req, res) {
    try {
      const {
        provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_user,
        smtp_password,
        gmail_user,
        gmail_app_password,
        microsoft_client_id,
        microsoft_client_secret,
        microsoft_tenant_id,
        from_email,
        from_name,
        is_enabled
      } = req.body;

      // Validate required fields based on provider
      if (provider === 'gmail') {
        if (!from_email) {
          return res.status(400).json({ success: false, message: 'From email is required' });
        }
        if (!gmail_user || (!gmail_app_password && !req.body.gmail_app_password_set)) {
          return res.status(400).json({ success: false, message: 'Gmail user and app password are required for Gmail provider' });
        }
      }

      if (provider === 'smtp') {
        if (!from_email) {
          return res.status(400).json({ success: false, message: 'From email is required' });
        }
        if (!smtp_host || !smtp_user) {
          return res.status(400).json({ success: false, message: 'SMTP host and user are required for SMTP provider' });
        }
      }

      if (provider === 'microsoft') {
        if (!microsoft_client_id || !microsoft_tenant_id) {
          return res.status(400).json({ success: false, message: 'Azure Client ID and Tenant ID are required for Microsoft provider' });
        }
        if (!microsoft_client_secret && !req.body.microsoft_client_secret_set) {
          return res.status(400).json({ success: false, message: 'Azure Client Secret is required for Microsoft provider' });
        }
      }

      const config = {
        provider: provider || 'smtp',
        smtp_host,
        smtp_port: smtp_port || 587,
        smtp_secure: smtp_secure || false,
        smtp_user,
        smtp_password,
        gmail_user,
        gmail_app_password,
        microsoft_client_id,
        microsoft_client_secret,
        microsoft_tenant_id,
        from_email,
        from_name: from_name || 'Unified ITSM Platform',
        is_enabled: is_enabled !== undefined ? is_enabled : true
      };

      await emailService.saveConfiguration(config, req.user.user_id);

      res.json({
        success: true,
        message: 'Email configuration saved successfully'
      });
    } catch (error) {
      console.error('Error saving email configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save email configuration',
        error: error.message
      });
    }
  },

  /**
   * Test email configuration
   * POST /api/v1/settings/email/test
   */
  async testConfiguration(req, res) {
    try {
      const { test_email } = req.body;

      if (!test_email) {
        return res.status(400).json({
          success: false,
          message: 'Test email address is required'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(test_email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email address format'
        });
      }

      const result = await emailService.testConfiguration(test_email);

      if (result.success) {
        res.json({
          success: true,
          message: `Test email sent successfully to ${test_email}`,
          data: {
            messageId: result.messageId
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to send test email',
          error: result.error
        });
      }
    } catch (error) {
      console.error('Error testing email configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test email configuration',
        error: error.message
      });
    }
  },

  /**
   * Get email statistics
   * GET /api/v1/settings/email/stats
   */
  async getStats(req, res) {
    try {
      const stats = await emailService.getEmailStats();

      res.json({
        success: true,
        data: {
          stats
        }
      });
    } catch (error) {
      console.error('Error getting email stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get email statistics',
        error: error.message
      });
    }
  },

  /**
   * Toggle email service
   * POST /api/v1/settings/email/toggle
   */
  async toggleService(req, res) {
    try {
      const { is_enabled } = req.body;

      const config = await emailService.getConfiguration();
      if (!config) {
        return res.status(400).json({
          success: false,
          message: 'No email configuration found. Please configure email settings first.'
        });
      }

      await emailService.saveConfiguration({
        ...config,
        is_enabled: is_enabled
      }, req.user.user_id);

      res.json({
        success: true,
        message: `Email service ${is_enabled ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error) {
      console.error('Error toggling email service:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle email service',
        error: error.message
      });
    }
  },

  /**
   * Get Microsoft OAuth authorization URL
   * GET /api/v1/settings/email/microsoft/auth-url
   */
  async getMicrosoftAuthUrl(req, res) {
    try {
      const config = await emailService.getConfiguration();

      if (!config) {
        return res.status(400).json({
          success: false,
          message: 'Please save email configuration with Microsoft credentials first'
        });
      }

      if (!config.microsoft_client_id || !config.microsoft_tenant_id) {
        return res.status(400).json({
          success: false,
          message: 'Microsoft Client ID and Tenant ID are required. Save configuration first.'
        });
      }

      const tenantId = config.microsoft_tenant_id || 'common';
      const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
      const redirectUri = `${baseUrl}/api/v1/settings/email/microsoft/callback`;

      const stateData = JSON.stringify({
        provider: 'microsoft',
        timestamp: Date.now()
      });

      const params = new URLSearchParams({
        client_id: config.microsoft_client_id,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'https://graph.microsoft.com/Mail.Send offline_access User.Read',
        state: encodeURIComponent(stateData),
        prompt: 'consent'
      });

      const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;

      res.json({
        success: true,
        data: { authUrl }
      });
    } catch (error) {
      console.error('Error generating Microsoft auth URL:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate Microsoft authentication URL',
        error: error.message
      });
    }
  },

  /**
   * Microsoft OAuth callback — exchanges code for tokens
   * GET /api/v1/settings/email/microsoft/callback
   */
  async handleMicrosoftCallback(req, res) {
    try {
      const { code, error: oauthError, error_description } = req.query;

      if (oauthError) {
        console.error('Microsoft OAuth error:', oauthError, error_description);
        return res.send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h2 style="color: #cf1322;">Authentication Failed</h2>
              <p>${error_description || oauthError}</p>
              <button onclick="window.close()" style="padding: 10px 24px; font-size: 16px; cursor: pointer;">Close Window</button>
            </body>
          </html>
        `);
      }

      if (!code) {
        return res.send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h2 style="color: #cf1322;">Authentication Failed</h2>
              <p>No authorization code received from Microsoft.</p>
              <button onclick="window.close()" style="padding: 10px 24px; font-size: 16px; cursor: pointer;">Close Window</button>
            </body>
          </html>
        `);
      }

      // Get stored config for client credentials
      const config = await emailService.getConfiguration();
      if (!config || !config.microsoft_client_id || !config.microsoft_client_secret) {
        return res.send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h2 style="color: #cf1322;">Configuration Error</h2>
              <p>Microsoft credentials not found in configuration.</p>
              <button onclick="window.close()" style="padding: 10px 24px; font-size: 16px; cursor: pointer;">Close Window</button>
            </body>
          </html>
        `);
      }

      const tenantId = config.microsoft_tenant_id || 'common';
      const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
      const redirectUri = `${baseUrl}/api/v1/settings/email/microsoft/callback`;

      // Exchange authorization code for tokens
      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
      const tokenParams = new URLSearchParams();
      tokenParams.append('client_id', config.microsoft_client_id);
      tokenParams.append('client_secret', config.microsoft_client_secret);
      tokenParams.append('code', code);
      tokenParams.append('redirect_uri', redirectUri);
      tokenParams.append('grant_type', 'authorization_code');

      const tokenResponse = await axios.post(tokenUrl, tokenParams, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Verify user identity via Graph API /me
      const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      });

      const userInfo = userResponse.data;
      const authenticatedEmail = userInfo.mail || userInfo.userPrincipalName;
      const displayName = userInfo.displayName || authenticatedEmail;

      // Store tokens and user info in database
      const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);
      const pool = await connectDB();
      await pool.request()
        .input('accessToken', sql.NVarChar(sql.MAX), access_token)
        .input('refreshToken', sql.NVarChar(sql.MAX), refresh_token)
        .input('expiresAt', sql.DateTime, expiresAt)
        .input('userEmail', sql.VarChar(255), authenticatedEmail)
        .input('displayName', sql.VarChar(255), displayName)
        .query(`
          UPDATE EMAIL_CONFIGURATION SET
            microsoft_access_token = @accessToken,
            microsoft_refresh_token = @refreshToken,
            microsoft_token_expires_at = @expiresAt,
            microsoft_user_email = @userEmail,
            microsoft_display_name = @displayName,
            microsoft_is_authenticated = 1,
            from_email = @userEmail,
            updated_at = GETUTCDATE()
        `);

      // Force re-init of email service
      emailService.isInitialized = false;

      res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #52c41a;">Authentication Successful!</h2>
            <p>Email <strong>${authenticatedEmail}</strong> (${displayName}) has been authenticated successfully with Microsoft 365.</p>
            <p>You can now close this window.</p>
            <button onclick="window.close()" style="padding: 10px 24px; font-size: 16px; cursor: pointer; background: #52c41a; color: white; border: none; border-radius: 4px;">Close Window</button>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Error in Microsoft OAuth callback:', error.response?.data || error.message);
      const errorMsg = error.response?.data?.error_description || error.message || 'Unknown error';
      res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #cf1322;">Authentication Failed</h2>
            <p>${errorMsg}</p>
            <button onclick="window.close()" style="padding: 10px 24px; font-size: 16px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }
  },

  /**
   * Revoke Microsoft authentication
   * POST /api/v1/settings/email/microsoft/revoke
   */
  async revokeMicrosoftAuth(req, res) {
    try {
      const pool = await connectDB();
      await pool.request().query(`
        UPDATE EMAIL_CONFIGURATION SET
          microsoft_access_token = NULL,
          microsoft_refresh_token = NULL,
          microsoft_token_expires_at = NULL,
          microsoft_user_email = NULL,
          microsoft_display_name = NULL,
          microsoft_is_authenticated = 0,
          updated_at = GETUTCDATE()
      `);

      // Force re-init
      emailService.isInitialized = false;

      res.json({
        success: true,
        message: 'Microsoft authentication revoked successfully'
      });
    } catch (error) {
      console.error('Error revoking Microsoft auth:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to revoke Microsoft authentication',
        error: error.message
      });
    }
  }
};

module.exports = EmailSettingsController;
