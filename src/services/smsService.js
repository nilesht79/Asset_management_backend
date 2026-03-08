/**
 * SMS SERVICE
 * Handles sending SMS via configurable HTTP-based SMS gateways (e.g., Tata Communications)
 * Configuration is stored in database and can be updated by superadmin
 */

const https = require('https');
const http = require('http');
const { connectDB, sql } = require('../config/database');

class SmsService {
  constructor() {
    this.config = null;
    this.isInitialized = false;
  }

  /**
   * Get SMS configuration from database
   */
  async getConfiguration() {
    try {
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT TOP 1 * FROM SMS_CONFIGURATION ORDER BY created_at DESC
      `);

      if (result.recordset.length === 0) {
        return null;
      }

      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching SMS configuration:', error);
      return null;
    }
  }

  /**
   * Save SMS configuration to database
   */
  async saveConfiguration(config, userId) {
    try {
      const pool = await connectDB();

      // Check if configuration exists
      const existing = await pool.request().query(`
        SELECT config_id FROM SMS_CONFIGURATION
      `);

      if (existing.recordset.length > 0) {
        // Update existing configuration
        await pool.request()
          .input('configId', sql.UniqueIdentifier, existing.recordset[0].config_id)
          .input('baseUrl', sql.VarChar(500), config.base_url)
          .input('username', sql.VarChar(255), config.username)
          .input('password', sql.VarChar(500), config.password)
          .input('senderId', sql.VarChar(50), config.sender_id)
          .input('peId', sql.VarChar(100), config.pe_id)
          .input('templateId', sql.VarChar(100), config.template_id)
          .input('isEnabled', sql.Bit, config.is_enabled)
          .input('updatedBy', sql.UniqueIdentifier, userId)
          .query(`
            UPDATE SMS_CONFIGURATION SET
              base_url = @baseUrl,
              username = @username,
              password = CASE WHEN @password IS NOT NULL AND @password != '' THEN @password ELSE password END,
              sender_id = @senderId,
              pe_id = @peId,
              template_id = @templateId,
              is_enabled = @isEnabled,
              updated_at = GETUTCDATE(),
              updated_by = @updatedBy
            WHERE config_id = @configId
          `);
      } else {
        // Insert new configuration
        await pool.request()
          .input('baseUrl', sql.VarChar(500), config.base_url)
          .input('username', sql.VarChar(255), config.username)
          .input('password', sql.VarChar(500), config.password)
          .input('senderId', sql.VarChar(50), config.sender_id)
          .input('peId', sql.VarChar(100), config.pe_id)
          .input('templateId', sql.VarChar(100), config.template_id)
          .input('isEnabled', sql.Bit, config.is_enabled)
          .input('updatedBy', sql.UniqueIdentifier, userId)
          .query(`
            INSERT INTO SMS_CONFIGURATION (
              base_url, username, password, sender_id, pe_id, template_id,
              is_enabled, updated_by
            ) VALUES (
              @baseUrl, @username, @password, @senderId, @peId, @templateId,
              @isEnabled, @updatedBy
            )
          `);
      }

      // Reinitialize with new config
      this.isInitialized = false;
      await this.initialize();

      return true;
    } catch (error) {
      console.error('Error saving SMS configuration:', error);
      throw error;
    }
  }

  /**
   * Initialize the SMS service based on configuration
   */
  async initialize() {
    if (this.isInitialized && this.config) {
      return true;
    }

    try {
      this.config = await this.getConfiguration();

      if (!this.config) {
        console.log('No SMS configuration found');
        return false;
      }

      if (!this.config.is_enabled) {
        console.log('SMS service is disabled');
        return false;
      }

      this.isInitialized = true;
      console.log('SMS service initialized');
      return true;
    } catch (error) {
      console.error('Error initializing SMS service:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Send an SMS via the configured gateway
   */
  async sendSms(recipient, messageText) {
    try {
      // Initialize if not already done
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          console.log('SMS service not initialized, logging SMS instead');
          this.logSms(recipient, messageText);
          return { success: false, reason: 'SMS service not configured or disabled' };
        }
      }

      // Build the query string for the SMS gateway
      // encodeURIComponent doesn't encode () which breaks DLT template matching
      const encode = (str) => encodeURIComponent(str).replace(/\(/g, '%28').replace(/\)/g, '%29');

      const queryParts = [
        `recipient=${encode(recipient)}`,
        `dr=false`,
        `msg=${encode(messageText)}`,
        `user=${encode(this.config.username)}`,
        `pswd=${encode(this.config.password)}`,
        `sender=${encode(this.config.sender_id)}`,
        `PE_ID=${encode(this.config.pe_id)}`,
        `Template_ID=${encode(this.config.template_id)}`
      ];

      const url = `${this.config.base_url}/campaignService/campaigns/qs?${queryParts.join('&')}`;
      console.log('SMS URL:', url);

      const response = await this._makeRequest(url);

      console.log(`SMS sent to ${recipient}: ${response}`);

      return {
        success: true,
        response: response
      };
    } catch (error) {
      console.error(`Error sending SMS to ${recipient}:`, error);
      this.logSms(recipient, messageText);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Make an HTTP/HTTPS GET request to the SMS gateway
   */
  _makeRequest(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;

      const req = client.get(url, { rejectUnauthorized: false }, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`SMS gateway returned status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('SMS gateway request timed out'));
      });
    });
  }

  /**
   * Test SMS configuration by sending a test SMS
   */
  async testConfiguration(testPhone, customMessage) {
    try {
      // Force re-initialization to pick up any config changes
      this.isInitialized = false;
      const initialized = await this.initialize();

      if (!initialized) {
        return {
          success: false,
          error: 'Failed to initialize SMS service. Check configuration.'
        };
      }

      // Use custom message if provided, otherwise use a generic fallback
      const testMessage = customMessage || 'Test SMS from Unified ITSM Platform';

      const result = await this.sendSms(testPhone, testMessage);

      // Update test status in database
      const pool = await connectDB();
      await pool.request()
        .input('testStatus', sql.VarChar(50), result.success ? 'success' : 'failed')
        .query(`
          UPDATE SMS_CONFIGURATION SET
            test_sms_sent_at = GETUTCDATE(),
            test_sms_status = @testStatus
        `);

      return result;
    } catch (error) {
      console.error('Error testing SMS configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log SMS to console (fallback when SMS is disabled)
   */
  logSms(recipient, messageText) {
    console.log('=== SMS LOG (Not Sent) ===');
    console.log(`To: ${recipient}`);
    console.log(`Message: ${messageText.substring(0, 500)}...`);
    console.log('==========================');
  }

  /**
   * Check if SMS service is enabled and configured
   */
  async isEnabled() {
    const config = await this.getConfiguration();
    return config && config.is_enabled;
  }

  /**
   * Get SMS statistics
   */
  async getSmsStats() {
    try {
      const pool = await connectDB();

      const result = await pool.request().query(`
        SELECT
          COUNT(*) AS total_sms,
          SUM(CASE WHEN delivery_status = 'sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN delivery_status = 'pending' THEN 1 ELSE 0 END) AS pending,
          MAX(sent_at) AS last_sent_at
        FROM SMS_LOG
      `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error getting SMS stats:', error);
      return { total_sms: 0, sent: 0, failed: 0, pending: 0, last_sent_at: null };
    }
  }
}

// Export singleton instance
module.exports = new SmsService();
