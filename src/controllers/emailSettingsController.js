/**
 * EMAIL SETTINGS CONTROLLER
 * Handles email configuration management for superadmin
 */

const emailService = require('../services/emailService');

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
        updated_at: config.updated_at
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
        from_email,
        from_name,
        is_enabled
      } = req.body;

      // Validate required fields
      if (!from_email) {
        return res.status(400).json({
          success: false,
          message: 'From email is required'
        });
      }

      if (provider === 'gmail' && (!gmail_user || (!gmail_app_password && !req.body.gmail_app_password_set))) {
        return res.status(400).json({
          success: false,
          message: 'Gmail user and app password are required for Gmail provider'
        });
      }

      if (provider === 'smtp' && (!smtp_host || !smtp_user)) {
        return res.status(400).json({
          success: false,
          message: 'SMTP host and user are required for SMTP provider'
        });
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
        from_email,
        from_name: from_name || 'Asset Management System',
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
  }
};

module.exports = EmailSettingsController;
