/**
 * EMAIL SERVICE
 * Handles sending emails via Gmail or SMTP
 * Configuration is stored in database and can be updated by superadmin
 */

const nodemailer = require('nodemailer');
const { connectDB, sql } = require('../config/database');

class EmailService {
  constructor() {
    this.transporter = null;
    this.config = null;
    this.isInitialized = false;
  }

  /**
   * Get email configuration from database
   */
  async getConfiguration() {
    try {
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT TOP 1 * FROM EMAIL_CONFIGURATION ORDER BY created_at DESC
      `);

      if (result.recordset.length === 0) {
        return null;
      }

      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching email configuration:', error);
      return null;
    }
  }

  /**
   * Save email configuration to database
   */
  async saveConfiguration(config, userId) {
    try {
      const pool = await connectDB();

      // Check if configuration exists
      const existing = await pool.request().query(`
        SELECT config_id FROM EMAIL_CONFIGURATION
      `);

      if (existing.recordset.length > 0) {
        // Update existing configuration
        await pool.request()
          .input('configId', sql.UniqueIdentifier, existing.recordset[0].config_id)
          .input('provider', sql.VarChar(20), config.provider)
          .input('smtpHost', sql.VarChar(255), config.smtp_host)
          .input('smtpPort', sql.Int, config.smtp_port)
          .input('smtpSecure', sql.Bit, config.smtp_secure)
          .input('smtpUser', sql.VarChar(255), config.smtp_user)
          .input('smtpPassword', sql.VarChar(500), config.smtp_password)
          .input('gmailUser', sql.VarChar(255), config.gmail_user)
          .input('gmailAppPassword', sql.VarChar(500), config.gmail_app_password)
          .input('isEnabled', sql.Bit, config.is_enabled)
          .input('updatedBy', sql.UniqueIdentifier, userId)
          .query(`
            UPDATE EMAIL_CONFIGURATION SET
              provider = @provider,
              smtp_host = @smtpHost,
              smtp_port = @smtpPort,
              smtp_secure = @smtpSecure,
              smtp_user = @smtpUser,
              smtp_password = CASE WHEN @smtpPassword IS NOT NULL AND @smtpPassword != '' THEN @smtpPassword ELSE smtp_password END,
              gmail_user = @gmailUser,
              gmail_app_password = CASE WHEN @gmailAppPassword IS NOT NULL AND @gmailAppPassword != '' THEN @gmailAppPassword ELSE gmail_app_password END,
              is_enabled = @isEnabled,
              updated_at = GETDATE(),
              updated_by = @updatedBy
            WHERE config_id = @configId
          `);
      } else {
        // Insert new configuration
        await pool.request()
          .input('provider', sql.VarChar(20), config.provider)
          .input('smtpHost', sql.VarChar(255), config.smtp_host)
          .input('smtpPort', sql.Int, config.smtp_port)
          .input('smtpSecure', sql.Bit, config.smtp_secure)
          .input('smtpUser', sql.VarChar(255), config.smtp_user)
          .input('smtpPassword', sql.VarChar(500), config.smtp_password)
          .input('gmailUser', sql.VarChar(255), config.gmail_user)
          .input('gmailAppPassword', sql.VarChar(500), config.gmail_app_password)
          .input('isEnabled', sql.Bit, config.is_enabled)
          .input('updatedBy', sql.UniqueIdentifier, userId)
          .query(`
            INSERT INTO EMAIL_CONFIGURATION (
              provider, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
              gmail_user, gmail_app_password, is_enabled, updated_by
            ) VALUES (
              @provider, @smtpHost, @smtpPort, @smtpSecure, @smtpUser, @smtpPassword,
              @gmailUser, @gmailAppPassword, @isEnabled, @updatedBy
            )
          `);
      }

      // Reinitialize transporter with new config
      this.isInitialized = false;
      await this.initialize();

      return true;
    } catch (error) {
      console.error('Error saving email configuration:', error);
      throw error;
    }
  }

  /**
   * Initialize the email transporter based on configuration
   */
  async initialize() {
    if (this.isInitialized && this.transporter) {
      return true;
    }

    try {
      this.config = await this.getConfiguration();

      if (!this.config) {
        console.log('No email configuration found');
        return false;
      }

      if (!this.config.is_enabled) {
        console.log('Email service is disabled');
        return false;
      }

      // Create transporter based on provider
      if (this.config.provider === 'gmail') {
        // Gmail with App Password
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: this.config.gmail_user,
            pass: this.config.gmail_app_password
          }
        });
      } else {
        // Generic SMTP
        this.transporter = nodemailer.createTransport({
          host: this.config.smtp_host,
          port: this.config.smtp_port,
          secure: this.config.smtp_secure, // true for 465, false for other ports
          auth: {
            user: this.config.smtp_user,
            pass: this.config.smtp_password
          },
          tls: {
            rejectUnauthorized: false // Allow self-signed certificates
          }
        });
      }

      this.isInitialized = true;
      console.log(`Email service initialized with ${this.config.provider} provider`);
      return true;
    } catch (error) {
      console.error('Error initializing email service:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Get the sender email based on provider
   */
  getSenderEmail() {
    if (!this.config) return null;
    return this.config.provider === 'gmail'
      ? this.config.gmail_user
      : this.config.smtp_user;
  }

  /**
   * Send an email
   */
  async sendEmail(to, subject, body, options = {}) {
    try {
      // Initialize if not already done
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          console.log('Email service not initialized, logging email instead');
          this.logEmail(to, subject, body);
          return { success: false, reason: 'Email service not configured or disabled' };
        }
      }

      // Use authentication email as sender (Gmail or SMTP user)
      const senderEmail = this.getSenderEmail();
      const senderName = 'Unified ITSM Platform';

      const mailOptions = {
        from: `"${senderName}" <${senderEmail}>`,
        to: to,
        subject: subject,
        text: body,
        ...options
      };

      // If HTML is provided, add it
      if (options.html) {
        mailOptions.html = options.html;
      }

      const info = await this.transporter.sendMail(mailOptions);

      console.log(`Email sent successfully to ${to}: ${info.messageId}`);

      return {
        success: true,
        messageId: info.messageId,
        response: info.response
      };
    } catch (error) {
      console.error(`Error sending email to ${to}:`, error);
      this.logEmail(to, subject, body);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send HTML email
   */
  async sendHtmlEmail(to, subject, htmlBody, textBody = null) {
    return this.sendEmail(to, subject, textBody || htmlBody, { html: htmlBody });
  }

  /**
   * Test email configuration by sending a test email
   */
  async testConfiguration(testEmail) {
    try {
      // Force re-initialization to pick up any config changes
      this.isInitialized = false;
      const initialized = await this.initialize();

      if (!initialized) {
        return {
          success: false,
          error: 'Failed to initialize email service. Check configuration.'
        };
      }

      const senderEmail = this.getSenderEmail();
      const subject = 'Test Email - Unified ITSM Platform';
      const body = `
This is a test email from the Unified ITSM Platform.

If you received this email, your email configuration is working correctly.

Configuration Details:
- Provider: ${this.config.provider}
- From: Unified ITSM Platform <${senderEmail}>
- Sent at: ${new Date().toISOString()}

This is an automated message. Please do not reply.
      `;

      const result = await this.sendEmail(testEmail, subject, body);

      // Update test status in database
      const pool = await connectDB();
      await pool.request()
        .input('testStatus', sql.VarChar(50), result.success ? 'success' : 'failed')
        .query(`
          UPDATE EMAIL_CONFIGURATION SET
            test_email_sent_at = GETDATE(),
            test_email_status = @testStatus
        `);

      return result;
    } catch (error) {
      console.error('Error testing email configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log email to console (fallback when email is disabled)
   */
  logEmail(to, subject, body) {
    console.log('=== EMAIL LOG (Not Sent) ===');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body.substring(0, 500)}...`);
    console.log('============================');
  }

  /**
   * Check if email service is enabled and configured
   */
  async isEnabled() {
    const config = await this.getConfiguration();
    return config && config.is_enabled;
  }

  /**
   * Get email statistics
   */
  async getEmailStats() {
    try {
      const pool = await connectDB();

      const result = await pool.request().query(`
        SELECT
          COUNT(*) AS total_notifications,
          SUM(CASE WHEN delivery_status = 'sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN delivery_status = 'pending' THEN 1 ELSE 0 END) AS pending,
          MAX(notification_sent_at) AS last_sent_at
        FROM ESCALATION_NOTIFICATIONS_LOG
      `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error getting email stats:', error);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
