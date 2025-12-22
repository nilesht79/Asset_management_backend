const express = require('express');
const bcrypt = require('bcryptjs');

const { connectDB, sql } = require('../../config/database');
const { validateBody } = require('../../middleware/validation');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendUnauthorized, sendNotFound } = require('../../utils/response');
const validators = require('../../utils/validators');
const authConfig = require('../../config/auth');

// Import role-based routes
const loginRoutes = require('./login');
const registerRoutes = require('./register');
const oauthLoginRoutes = require('./oauth-login');
const passwordResetRoutes = require('./password-reset');

const router = express.Router();

// Mount role-based authentication routes
router.use('/login', loginRoutes);
router.use('/register', registerRoutes);
router.use('/', oauthLoginRoutes);

// Mount password reset routes
router.use('/', passwordResetRoutes);


// Legacy JWT refresh token endpoint has been deprecated
// Use OAuth 2.0 refresh token endpoint instead: POST /auth/oauth-refresh
router.post('/refresh-token', (_, res) => {
  return sendError(res, {
    message: 'JWT refresh token endpoint has been deprecated. Use OAuth 2.0 refresh token endpoint instead.',
    oauth_endpoint: '/auth/oauth-refresh',
    required_parameters: {
      refresh_token: 'string',
      client_id: 'string (use: asset-management-web)'
    }
  }, 410); // 410 Gone
});

// Legacy JWT logout endpoint has been deprecated
// Use OAuth 2.0 token revocation endpoint instead: POST /oauth/revoke
router.post('/logout', (_, res) => {
  return sendError(res, {
    message: 'JWT logout endpoint has been deprecated. Use OAuth 2.0 token revocation endpoint instead.',
    oauth_endpoint: '/oauth/revoke',
    required_parameters: {
      token: 'string (access_token or refresh_token)'
    }
  }, 410); // 410 Gone
});

// Password change endpoint updated to use OAuth authentication
router.put('/change-password',
  authenticateToken, // Now uses OAuth authentication
  validateBody(validators.user.changePassword),
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;

    const pool = await connectDB();

    // Get current password hash
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query('SELECT password_hash FROM USER_MASTER WHERE user_id = @userId');

    if (userResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    const user = userResult.recordset[0];

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isCurrentPasswordValid) {
      return sendUnauthorized(res, 'Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(new_password, authConfig.bcrypt.saltRounds);

    // Update password and clear must_change_password flag
    await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .input('passwordHash', sql.VarChar(255), newPasswordHash)
      .query(`
        UPDATE USER_MASTER
        SET password_hash = @passwordHash,
            password_changed_at = GETUTCDATE(),
            must_change_password = 0,
            updated_at = GETUTCDATE()
        WHERE user_id = @userId
      `);

    // Revoke all OAuth tokens to force re-login
    await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query(`
        UPDATE oauth_access_tokens SET is_revoked = 1 WHERE user_id = @userId;
        UPDATE oauth_refresh_tokens SET is_revoked = 1 WHERE user_id = @userId;
      `);

    sendSuccess(res, null, 'Password changed successfully. Please login again.');
  })
);

// GET /auth/profile
router.get('/profile',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query(`
        SELECT u.user_id, u.email, u.first_name, u.last_name, u.role,
               u.employee_id, u.is_active, u.last_login, u.created_at,
               u.must_change_password,
               d.department_name, d.department_id,
               l.name as location_name, l.id as location_id
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE u.user_id = @userId
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'User profile not found');
    }

    const user = result.recordset[0];

    const userData = {
      id: user.user_id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      employeeId: user.employee_id,
      isActive: user.is_active,
      mustChangePassword: Boolean(user.must_change_password),
      lastLogin: user.last_login,
      createdAt: user.created_at,
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

    sendSuccess(res, userData, 'Profile retrieved successfully');
  })
);

// PUT /auth/profile
router.put('/profile',
  authenticateToken,
  validateBody(validators.user.update),
  asyncHandler(async (req, res) => {
    const { first_name, last_name } = req.body;

    const pool = await connectDB();

    await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .input('firstName', sql.VarChar(50), first_name)
      .input('lastName', sql.VarChar(50), last_name)
      .query(`
        UPDATE USER_MASTER
        SET first_name = @firstName,
            last_name = @lastName,
            updated_at = GETUTCDATE()
        WHERE user_id = @userId
      `);

    sendSuccess(res, null, 'Profile updated successfully');
  })
);

module.exports = router;