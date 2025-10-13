const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { connectDB, sql } = require('../../config/database');
const { validateBody } = require('../../middleware/validation');
const { registrationLimiter } = require('../../middleware/rate-limit');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendValidationError } = require('../../utils/response');
const validators = require('../../utils/validators');
const authConfig = require('../../config/auth');

const router = express.Router();

// Removed master key requirement - direct superadmin registration allowed

// Generic registration function
const performRegistration = async (req, res, role) => {
  const { firstName, lastName, email, password, confirmPassword, registrationType } = req.body;

  // Validate password match
  if (password !== confirmPassword) {
    return sendValidationError(res, 'Passwords do not match');
  }

  const pool = await connectDB();
  
  try {
    // Check if email already exists
    const emailCheck = await pool.request()
      .input('email', sql.VarChar(255), email.toLowerCase())
      .query('SELECT user_id FROM USER_MASTER WHERE email = @email');

    if (emailCheck.recordset.length > 0) {
      return sendValidationError(res, 'Email address is already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, authConfig.bcrypt.saltRounds);

    // Generate unique user ID and employee ID
    const userId = uuidv4();
    const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
    const employeeId = `${role === 'superadmin' ? 'SA' : role === 'admin' ? 'AD' : role.substring(0,3).toUpperCase()}-${timestamp}`;

    // Insert new user
    await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .input('email', sql.VarChar(255), email.toLowerCase())
      .input('passwordHash', sql.VarChar(255), passwordHash)
      .input('firstName', sql.VarChar(50), firstName)
      .input('lastName', sql.VarChar(50), lastName)
      .input('role', sql.VarChar(20), role)
      .input('employeeId', sql.VarChar(20), employeeId)
      .input('isActive', sql.Bit, role === 'superadmin' ? 1 : 0) // Auto-activate superadmin, others need approval
      .input('registrationType', sql.VarChar(20), registrationType || 'self-registration')
      .query(`
        INSERT INTO USER_MASTER (
          user_id, email, password_hash, first_name, last_name, role, employee_id, 
          is_active, registration_type, created_at, updated_at
        ) VALUES (
          @userId, @email, @passwordHash, @firstName, @lastName, @role, @employeeId,
          @isActive, @registrationType, GETUTCDATE(), GETUTCDATE()
        )
      `);

    // Log registration activity
    await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .input('activityType', sql.VarChar(50), 'REGISTRATION')
      .input('description', sql.VarChar(255), `Self-registered as ${role}`)
      .input('ipAddress', sql.VarChar(45), req.ip)
      .input('userAgent', sql.VarChar(500), req.get('User-Agent') || '')
      .query(`
        INSERT INTO user_activity_logs (
          id, user_id, activity_type, description, ip_address, user_agent, created_at
        ) VALUES (
          NEWID(), @userId, @activityType, @description, @ipAddress, @userAgent, GETUTCDATE()
        )
      `);

    const message = role === 'superadmin' 
      ? 'Super Admin account created successfully! You can now login.'
      : 'Admin account created successfully! Your account is pending approval. You will be notified once approved.';

    return sendSuccess(res, {
      user: {
        id: userId,
        email: email.toLowerCase(),
        firstName,
        lastName,
        role,
        employeeId,
        isActive: role === 'superadmin'
      }
    }, message);

  } catch (error) {
    console.error('Registration error:', error);
    return sendError(res, 'Registration failed. Please try again later.', 500);
  }
};

// Admin registration
router.post('/admin', 
  registrationLimiter,
  validateBody(validators.auth.adminRegister),
  asyncHandler(async (req, res) => {
    await performRegistration(req, res, 'admin');
  })
);

// Superadmin registration
router.post('/superadmin', 
  registrationLimiter,
  validateBody(validators.auth.superadminRegister),
  asyncHandler(async (req, res) => {
    await performRegistration(req, res, 'superadmin');
  })
);

// Generic registration endpoint (for other roles when needed)
router.post('/', 
  registrationLimiter,
  validateBody(validators.auth.register),
  asyncHandler(async (req, res) => {
    const { role } = req.body;
    
    // Only allow admin and superadmin self-registration
    if (!['admin', 'superadmin'].includes(role)) {
      return sendValidationError(res, 'Self-registration is only available for admin and superadmin roles');
    }
    
    await performRegistration(req, res, role);
  })
);

module.exports = router;