/**
 * Password Generator Utility
 * Generates secure random passwords that meet validation requirements
 */

/**
 * Generate a secure random password
 * Pattern: One Uppercase + lowercase + numbers + special + random mix
 * Meets requirements: min 8 chars, uppercase, lowercase, number, special character
 *
 * @param {number} length - Password length (default: 12)
 * @returns {string} Generated password
 */
function generateSecurePassword(length = 12) {
  // Character sets
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = '@$!%*?&';

  // Ensure minimum length
  if (length < 8) {
    length = 8;
  }

  // Start with one character from each required set to guarantee requirements
  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill the rest with random characters from all sets
  const allChars = lowercase + uppercase + numbers + special;
  const remainingLength = length - 4;

  for (let i = 0; i < remainingLength; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle the password to randomize character positions
  password = password.split('').sort(() => Math.random() - 0.5).join('');

  return password;
}

/**
 * Generate a memorable password based on pattern
 * Pattern: Word + Number + Special + Word
 * Example: Happy123!Time
 *
 * @returns {string} Generated memorable password
 */
function generateMemorablePassword() {
  const words = [
    'Happy', 'Lucky', 'Swift', 'Bright', 'Smart', 'Quick', 'Cool', 'Super',
    'Magic', 'Power', 'Strong', 'Brave', 'Bold', 'Fast', 'Safe', 'True'
  ];

  const numbers = Math.floor(100 + Math.random() * 900); // 3-digit number
  const special = '@$!%*?&'[Math.floor(Math.random() * 7)];

  const word1 = words[Math.floor(Math.random() * words.length)];
  const word2 = words[Math.floor(Math.random() * words.length)];

  return `${word1}${numbers}${special}${word2}`;
}

/**
 * Generate password from user information
 * Pattern: FirstName + SpecialChar + Number + LastNameInitial
 * Example: John@2024K
 *
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @returns {string} Generated password
 */
function generatePasswordFromName(firstName, lastName) {
  const special = '@$!%*?&'[Math.floor(Math.random() * 7)];
  const year = new Date().getFullYear();
  const randomNum = Math.floor(10 + Math.random() * 90); // 2-digit number

  const firstNameCap = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  const lastInitial = lastName.charAt(0).toUpperCase();

  return `${firstNameCap}${special}${year}${randomNum}${lastInitial}`;
}

/**
 * Validate generated password meets requirements
 * @param {string} password - Password to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateGeneratedPassword(password) {
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[@$!%*?&]/.test(password);
  const hasMinLength = password.length >= 8;

  return hasLowercase && hasUppercase && hasNumber && hasSpecial && hasMinLength;
}

/**
 * Generate multiple unique passwords
 * @param {number} count - Number of passwords to generate
 * @param {number} length - Password length
 * @returns {Array<string>} Array of unique passwords
 */
function generateMultiplePasswords(count, length = 12) {
  const passwords = new Set();

  while (passwords.size < count) {
    const password = generateSecurePassword(length);
    passwords.add(password);
  }

  return Array.from(passwords);
}

module.exports = {
  generateSecurePassword,
  generateMemorablePassword,
  generatePasswordFromName,
  validateGeneratedPassword,
  generateMultiplePasswords
};
