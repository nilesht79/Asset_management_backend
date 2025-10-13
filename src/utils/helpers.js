const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const helpers = {
  // Generate unique ID
  generateId: () => uuidv4(),
  
  // Generate random string
  generateRandomString: (length = 10) => {
    return crypto.randomBytes(length).toString('hex').substring(0, length);
  },
  
  // Format date
  formatDate: (date, format = 'YYYY-MM-DD') => {
    return moment(date).format(format);
  },
  
  // Get current timestamp
  getCurrentTimestamp: () => {
    return moment().toISOString();
  },
  
  // Check if date is valid
  isValidDate: (date) => {
    return moment(date).isValid();
  },
  
  // Add days to date
  addDays: (date, days) => {
    return moment(date).add(days, 'days').toISOString();
  },
  
  // Get difference between dates in specified unit
  getDateDiff: (startDate, endDate, unit = 'days') => {
    return moment(endDate).diff(moment(startDate), unit);
  },
  
  // Sanitize string (remove special characters, spaces, etc.)
  sanitizeString: (str) => {
    return str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  },
  
  // Generate slug from string
  generateSlug: (str) => {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
  
  // Capitalize first letter
  capitalizeFirst: (str) => {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  },
  
  // Convert to title case
  toTitleCase: (str) => {
    return str.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  },
  
  // Deep clone object
  deepClone: (obj) => {
    return JSON.parse(JSON.stringify(obj));
  },
  
  // Remove undefined/null values from object
  cleanObject: (obj) => {
    const cleaned = {};
    Object.keys(obj).forEach(key => {
      if (obj[key] !== null && obj[key] !== undefined) {
        if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          const nestedCleaned = helpers.cleanObject(obj[key]);
          if (Object.keys(nestedCleaned).length > 0) {
            cleaned[key] = nestedCleaned;
          }
        } else {
          cleaned[key] = obj[key];
        }
      }
    });
    return cleaned;
  },
  
  // Flatten nested object
  flattenObject: (obj, prefix = '') => {
    const flattened = {};
    Object.keys(obj).forEach(key => {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(flattened, helpers.flattenObject(obj[key], newKey));
      } else {
        flattened[newKey] = obj[key];
      }
    });
    return flattened;
  },
  
  // Get nested property safely
  getNestedProperty: (obj, path) => {
    return path.split('.').reduce((current, key) => 
      current && current[key] !== undefined ? current[key] : undefined, obj
    );
  },
  
  // Format file size
  formatFileSize: (bytes) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },
  
  // Generate pagination info
  getPaginationInfo: (page, limit, total) => {
    const currentPage = parseInt(page) || 1;
    const itemsPerPage = parseInt(limit) || 10;
    const totalItems = parseInt(total) || 0;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

    return {
      page: currentPage,        // For frontend compatibility
      limit: itemsPerPage,       // For frontend compatibility
      total: totalItems,         // For frontend compatibility
      currentPage,
      itemsPerPage,
      totalItems,
      totalPages,
      startIndex,
      endIndex,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
      nextPage: currentPage < totalPages ? currentPage + 1 : null,
      prevPage: currentPage > 1 ? currentPage - 1 : null
    };
  },
  
  // Sleep/delay function
  sleep: (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  // Validate email format
  isValidEmail: (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },
  
  // Validate phone number (basic)
  isValidPhone: (phone) => {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
  },
  
  // Generate random number between min and max
  getRandomNumber: (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  
  // Calculate percentage
  calculatePercentage: (value, total) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100 * 100) / 100;
  },
  
  // Truncate text
  truncateText: (text, length = 100, suffix = '...') => {
    if (text.length <= length) return text;
    return text.substring(0, length).trim() + suffix;
  },
  
  // Mask sensitive data (email, phone, etc.)
  maskData: (data, type = 'email') => {
    if (!data) return '';
    
    switch (type) {
      case 'email':
        const [username, domain] = data.split('@');
        const maskedUsername = username.substring(0, 2) + '*'.repeat(Math.max(0, username.length - 2));
        return `${maskedUsername}@${domain}`;
      
      case 'phone':
        const cleaned = data.replace(/\D/g, '');
        return cleaned.substring(0, 2) + '*'.repeat(Math.max(0, cleaned.length - 4)) + cleaned.substring(cleaned.length - 2);
      
      default:
        return '*'.repeat(data.length);
    }
  }
};

module.exports = helpers;