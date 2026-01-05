const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const authConfig = require('../config/auth');
const { generateUniqueEmailWithBatch } = require('./email-generator');
const { findDepartmentByName } = require('./department-helper');
const { findLocationByName } = require('./location-helper');

/**
 * Parse Excel file and extract user data
 * @param {Buffer} fileBuffer - Excel file buffer
 * @returns {Promise<Array>} Array of parsed user objects
 */
async function parseUserExcel(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('Users');
  if (!worksheet) {
    throw new Error('Users worksheet not found in Excel file');
  }

  const users = [];
  const headers = {};

  // Read headers from first row
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const header = cell.value?.toString().toLowerCase().replace(/\*/g, '').trim();
    headers[colNumber] = header;
  });

  // Process data rows (skip header row)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const userData = { rowNumber };

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        let value = cell.value;

        // Handle different cell types
        if (value === null || value === undefined || value === '') {
          value = null;
        } else if (typeof value === 'object' && value.text) {
          value = value.text; // Rich text
        } else {
          value = value.toString().trim();
        }

        // Map to standardized field names
        const fieldMap = {
          'first name': 'first_name',
          'last name': 'last_name',
          'email': 'email',
          'password': 'password',
          'role': 'role',
          'employee id': 'employee_id',
          'designation': 'designation',
          'department name': 'department_name',
          'location name': 'location_name',
          'is active': 'is_active',
          'is vip': 'is_vip'
        };

        const fieldName = fieldMap[header] || header;
        userData[fieldName] = value;
      }
    });

    // Skip completely empty rows
    const hasData = Object.keys(userData).some(key =>
      key !== 'rowNumber' && userData[key] !== null
    );

    if (hasData) {
      users.push(userData);
    }
  });

  return users;
}

/**
 * Validate a single user record
 * @param {Object} user - User data object
 * @param {Object} context - Validation context (existing emails, departments, etc.)
 * @returns {Object} Validation result { valid: boolean, errors: [] }
 */
function validateUserRecord(user, context = {}) {
  const errors = [];
  const { existingEmails = [], existingEmployeeIds = [], departments = [] } = context;

  // Required fields
  if (!user.first_name || user.first_name.length < 1 || user.first_name.length > 50) {
    errors.push('First name is required (1-50 characters)');
  }

  if (!user.last_name || user.last_name.length < 1 || user.last_name.length > 50) {
    errors.push('Last name is required (1-50 characters)');
  }

  // Email validation (optional - will auto-generate if not provided)
  if (user.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(user.email)) {
      errors.push('Invalid email format');
    }
    if (existingEmails.includes(user.email.toLowerCase())) {
      errors.push('Email already exists in system');
    }
  }
  // Email is optional - will be auto-generated during processing if not provided
  // Password is not handled in bulk upload - users must use reset password flow

  // Role validation
  const validRoles = Object.values(authConfig.roles);
  if (!user.role) {
    errors.push('Role is required');
  } else if (!validRoles.includes(user.role)) {
    errors.push(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
  }

  // Employee ID validation (if provided)
  if (user.employee_id) {
    if (user.employee_id.length > 20) {
      errors.push('Employee ID must be 20 characters or less');
    }
    if (existingEmployeeIds.includes(user.employee_id)) {
      errors.push('Employee ID already exists in system');
    }
  }

  // Boolean fields validation
  if (user.is_active !== null && !['true', 'false', '1', '0'].includes(user.is_active?.toLowerCase())) {
    errors.push('Is Active must be true or false');
  }

  if (user.is_vip !== null && !['true', 'false', '1', '0'].includes(user.is_vip?.toLowerCase())) {
    errors.push('Is VIP must be true or false');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Process and prepare user data for database insertion
 * @param {Object} user - User data from Excel
 * @param {Array} departments - Available departments
 * @param {Set} batchEmails - Set of emails already in the current batch (for collision detection)
 * @param {Object} pool - Database connection pool (optional, for employee ID generation)
 * @param {Object} employeeIdTracker - Object to track next employee ID number across batch
 * @param {Array} locations - Available locations (optional)
 * @returns {Object} Processed user data ready for DB insertion
 */
async function processUserForInsertion(user, departments = [], batchEmails = new Set(), pool = null, employeeIdTracker = null, locations = []) {
  const userId = uuidv4();

  // Auto-generate email if not provided
  let finalEmail = user.email;
  if (!finalEmail || finalEmail.trim() === '') {
    finalEmail = await generateUniqueEmailWithBatch(user.first_name, user.last_name, batchEmails);
  }

  // No password handling - users will use reset password flow
  // Superadmin can also reset passwords manually

  // Get department from pre-loaded array (in-memory lookup only)
  let departmentId = null;
  if (user.department_name) {
    const department = findDepartmentByName(user.department_name, departments);
    if (department) {
      departmentId = department.department_id;
    }
  }

  // Get location from pre-loaded array (in-memory lookup only)
  let locationId = null;
  if (user.location_name) {
    const location = findLocationByName(user.location_name, locations);
    if (location) {
      locationId = location.id;
    }
  }

  // Generate employee ID if not provided
  let employeeId = user.employee_id || null;
  if (!employeeId && pool && employeeIdTracker) {
    // Generate sequential employee ID starting with T-10000
    // Use tracker to maintain sequence across batch
    if (!employeeIdTracker.initialized) {
      // Get the highest existing employee ID that matches the pattern T-#####
      const maxIdResult = await pool.request()
        .query(`
          SELECT TOP 1 employee_id
          FROM USER_MASTER
          WHERE employee_id LIKE 'T-%'
            AND LEN(employee_id) = 7
            AND ISNUMERIC(SUBSTRING(employee_id, 3, 5)) = 1
          ORDER BY CAST(SUBSTRING(employee_id, 3, 5) AS INT) DESC
        `);

      employeeIdTracker.nextNumber = 10000; // Starting number
      if (maxIdResult.recordset.length > 0 && maxIdResult.recordset[0].employee_id) {
        const currentMax = maxIdResult.recordset[0].employee_id;
        const currentNumber = parseInt(currentMax.substring(2)); // Extract number after 'T-'
        employeeIdTracker.nextNumber = currentNumber + 1;
      }
      employeeIdTracker.initialized = true;
    }

    employeeId = `T-${employeeIdTracker.nextNumber}`;
    employeeIdTracker.nextNumber++; // Increment for next user
  } else if (!employeeId) {
    // Fallback if pool not provided (shouldn't happen in normal flow)
    employeeId = `T-${Math.floor(10000 + Math.random() * 90000)}`;
  }

  // Parse boolean values
  const parseBoolean = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return ['true', '1', 'yes'].includes(value.toLowerCase());
  };

  const isActive = parseBoolean(user.is_active) !== null ? parseBoolean(user.is_active) : true;
  const isVip = parseBoolean(user.is_vip) !== null ? parseBoolean(user.is_vip) : false;

  return {
    user_id: userId,
    first_name: user.first_name.trim(),
    last_name: user.last_name.trim(),
    email: finalEmail.toLowerCase().trim(),
    role: user.role,
    employee_id: employeeId,
    designation: user.designation ? user.designation.trim() : null,
    department_id: departmentId,
    location_id: locationId,
    is_active: isActive,
    is_vip: isVip,
    email_verified: false,
    registration_type: 'bulk-upload',
    user_status: isActive ? 'active' : 'pending',
    must_change_password: true // Users must reset password on first login
  };
}

/**
 * Validate all users in batch before processing
 * @param {Array} users - Array of user objects from Excel
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Validation results
 */
async function validateBulkUsers(users, pool) {
  // Get existing emails from database
  const emailsResult = await pool.request().query('SELECT email FROM USER_MASTER');
  const existingEmails = emailsResult.recordset.map(r => r.email.toLowerCase());

  // Get existing employee IDs
  const employeeIdsResult = await pool.request().query('SELECT employee_id FROM USER_MASTER WHERE employee_id IS NOT NULL');
  const existingEmployeeIds = employeeIdsResult.recordset.map(r => r.employee_id);

  // Get all departments
  const departmentsResult = await pool.request().query('SELECT department_id, department_name, description FROM DEPARTMENT_MASTER');
  const departments = departmentsResult.recordset;

  // Get all locations
  const locationsResult = await pool.request().query('SELECT id, name, address, city_name, state_name FROM locations WHERE is_active = 1');
  const locations = locationsResult.recordset;

  // Track emails and employee IDs within the upload batch
  const batchEmails = new Set();
  const batchEmployeeIds = new Set();

  const validationResults = [];

  for (const user of users) {
    // Check for duplicates within the batch
    const batchContext = { existingEmails: [...existingEmails], existingEmployeeIds: [...existingEmployeeIds], departments };

    if (user.email) {
      const lowerEmail = user.email.toLowerCase();
      if (batchEmails.has(lowerEmail)) {
        batchContext.existingEmails.push(lowerEmail);
      } else {
        batchEmails.add(lowerEmail);
      }
    }

    if (user.employee_id) {
      if (batchEmployeeIds.has(user.employee_id)) {
        batchContext.existingEmployeeIds.push(user.employee_id);
      } else {
        batchEmployeeIds.add(user.employee_id);
      }
    }

    const validation = validateUserRecord(user, batchContext);

    validationResults.push({
      rowNumber: user.rowNumber,
      user: user,
      valid: validation.valid,
      errors: validation.errors
    });
  }

  return {
    validationResults,
    departments,
    locations,
    totalRows: users.length,
    validRows: validationResults.filter(r => r.valid).length,
    invalidRows: validationResults.filter(r => !r.valid).length
  };
}

module.exports = {
  parseUserExcel,
  validateUserRecord,
  processUserForInsertion,
  validateBulkUsers
};
