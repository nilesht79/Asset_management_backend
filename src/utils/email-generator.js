const { connectDB, sql } = require('../config/database');

/**
 * Sanitize a string for use in email (remove special chars, convert to lowercase)
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeForEmail(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
    .trim();
}

/**
 * Generate email from first name and last name
 * Pattern: firstname.lastname@company.local
 * If duplicate, append number: firstname.lastname2@company.local
 *
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @param {string} domain - Email domain (default: 'company.local')
 * @returns {Promise<string>} Generated unique email
 */
async function generateUniqueEmail(firstName, lastName, domain = 'company.local') {
  const pool = await connectDB();

  // Sanitize names
  const sanitizedFirst = sanitizeForEmail(firstName);
  const sanitizedLast = sanitizeForEmail(lastName);

  // Base email pattern
  let baseEmail = `${sanitizedFirst}.${sanitizedLast}@${domain}`;
  let email = baseEmail;
  let counter = 2;

  // Check if email exists in database
  let exists = await emailExists(email, pool);

  // If exists, append counter until we find a unique one
  while (exists) {
    email = `${sanitizedFirst}.${sanitizedLast}${counter}@${domain}`;
    exists = await emailExists(email, pool);
    counter++;

    // Safety check to prevent infinite loop
    if (counter > 1000) {
      throw new Error('Unable to generate unique email after 1000 attempts');
    }
  }

  return email;
}

/**
 * Check if an email already exists in the database
 * @param {string} email - Email to check
 * @param {Object} pool - Database connection pool (optional, will create if not provided)
 * @returns {Promise<boolean>} True if email exists, false otherwise
 */
async function emailExists(email, pool = null) {
  const dbPool = pool || await connectDB();

  const result = await dbPool.request()
    .input('email', sql.VarChar(255), email.toLowerCase())
    .query('SELECT COUNT(*) as count FROM USER_MASTER WHERE LOWER(email) = LOWER(@email)');

  return result.recordset[0].count > 0;
}

/**
 * Generate email and ensure it's unique within a batch of users
 * Used during bulk upload to avoid duplicates within the same batch
 *
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @param {Set} batchEmails - Set of emails already in the current batch
 * @param {string} domain - Email domain (default: 'company.local')
 * @returns {Promise<string>} Generated unique email
 */
async function generateUniqueEmailWithBatch(firstName, lastName, batchEmails, domain = 'company.local') {
  const pool = await connectDB();

  // Sanitize names
  const sanitizedFirst = sanitizeForEmail(firstName);
  const sanitizedLast = sanitizeForEmail(lastName);

  // Base email pattern
  let baseEmail = `${sanitizedFirst}.${sanitizedLast}@${domain}`;
  let email = baseEmail;
  let counter = 2;

  // Check if email exists in database OR in the batch
  let exists = await emailExists(email, pool) || batchEmails.has(email.toLowerCase());

  // If exists, append counter until we find a unique one
  while (exists) {
    email = `${sanitizedFirst}.${sanitizedLast}${counter}@${domain}`;
    exists = await emailExists(email, pool) || batchEmails.has(email.toLowerCase());
    counter++;

    // Safety check
    if (counter > 1000) {
      throw new Error('Unable to generate unique email after 1000 attempts');
    }
  }

  return email;
}

module.exports = {
  generateUniqueEmail,
  generateUniqueEmailWithBatch,
  emailExists,
  sanitizeForEmail
};
