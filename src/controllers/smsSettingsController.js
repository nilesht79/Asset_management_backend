/**
 * SMS SETTINGS CONTROLLER
 * Handles SMS configuration management for superadmin
 */

const smsService = require('../services/smsService');

const SmsSettingsController = {
  /**
   * Get SMS configuration
   * GET /api/v1/settings/sms
   */
  async getConfiguration(req, res) {
    try {
      const config = await smsService.getConfiguration();

      if (!config) {
        return res.json({
          success: true,
          data: {
            config: null,
            message: 'No SMS configuration found'
          }
        });
      }

      // Hide sensitive data
      const safeConfig = {
        config_id: config.config_id,
        base_url: config.base_url,
        username: config.username,
        password_set: !!config.password,
        sender_id: config.sender_id,
        pe_id: config.pe_id,
        template_id: config.template_id,
        is_enabled: config.is_enabled,
        test_sms_sent_at: config.test_sms_sent_at,
        test_sms_status: config.test_sms_status,
        updated_at: config.updated_at
      };

      res.json({
        success: true,
        data: {
          config: safeConfig
        }
      });
    } catch (error) {
      console.error('Error getting SMS configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SMS configuration',
        error: error.message
      });
    }
  },

  /**
   * Save SMS configuration
   * POST /api/v1/settings/sms
   */
  async saveConfiguration(req, res) {
    try {
      const {
        base_url,
        username,
        password,
        sender_id,
        pe_id,
        template_id,
        is_enabled
      } = req.body;

      // Validate required fields
      if (!base_url) {
        return res.status(400).json({
          success: false,
          message: 'SMS Gateway Base URL is required'
        });
      }

      if (!username) {
        return res.status(400).json({
          success: false,
          message: 'Username is required'
        });
      }

      if (!sender_id) {
        return res.status(400).json({
          success: false,
          message: 'Sender ID is required'
        });
      }

      const config = {
        base_url,
        username,
        password,
        sender_id,
        pe_id: pe_id || null,
        template_id: template_id || null,
        is_enabled: is_enabled !== undefined ? is_enabled : true
      };

      await smsService.saveConfiguration(config, req.user.user_id);

      res.json({
        success: true,
        message: 'SMS configuration saved successfully'
      });
    } catch (error) {
      console.error('Error saving SMS configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save SMS configuration',
        error: error.message
      });
    }
  },

  /**
   * Test SMS configuration
   * POST /api/v1/settings/sms/test
   */
  async testConfiguration(req, res) {
    try {
      const { test_phone, test_message } = req.body;

      if (!test_phone) {
        return res.status(400).json({
          success: false,
          message: 'Test phone number is required'
        });
      }

      // Validate phone format (Indian mobile: 91XXXXXXXXXX or 10-digit)
      const phoneRegex = /^(91\d{10}|\d{10})$/;
      if (!phoneRegex.test(test_phone.replace(/[\s\-\+]/g, ''))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format. Use 10-digit number or with 91 prefix.'
        });
      }

      // Ensure phone has 91 prefix
      let formattedPhone = test_phone.replace(/[\s\-\+]/g, '');
      if (formattedPhone.length === 10) {
        formattedPhone = '91' + formattedPhone;
      }

      const result = await smsService.testConfiguration(formattedPhone, test_message);

      if (result.success) {
        res.json({
          success: true,
          message: `Test SMS sent successfully to ${formattedPhone}`,
          data: {
            response: result.response
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to send test SMS',
          error: result.error
        });
      }
    } catch (error) {
      console.error('Error testing SMS configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test SMS configuration',
        error: error.message
      });
    }
  },

  /**
   * Get SMS statistics
   * GET /api/v1/settings/sms/stats
   */
  async getStats(req, res) {
    try {
      const stats = await smsService.getSmsStats();

      res.json({
        success: true,
        data: {
          stats
        }
      });
    } catch (error) {
      console.error('Error getting SMS stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SMS statistics',
        error: error.message
      });
    }
  },

  /**
   * Toggle SMS service
   * POST /api/v1/settings/sms/toggle
   */
  async toggleService(req, res) {
    try {
      const { is_enabled } = req.body;

      const config = await smsService.getConfiguration();
      if (!config) {
        return res.status(400).json({
          success: false,
          message: 'No SMS configuration found. Please configure SMS settings first.'
        });
      }

      await smsService.saveConfiguration({
        ...config,
        is_enabled: is_enabled
      }, req.user.user_id);

      res.json({
        success: true,
        message: `SMS service ${is_enabled ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error) {
      console.error('Error toggling SMS service:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle SMS service',
        error: error.message
      });
    }
  }
};

module.exports = SmsSettingsController;
