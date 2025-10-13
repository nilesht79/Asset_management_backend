/**
 * FIX PERMISSION SERVICE COLUMN MISMATCHES
 * This script identifies and fixes all column name mismatches between
 * the database schema and the permissionService.js code
 */

const fs = require('fs');
const path = require('path');

const serviceFilePath = path.join(__dirname, '../src/services/permissionService.js');

console.log('===========================================');
console.log('FIXING PERMISSION SERVICE COLUMN MISMATCHES');
console.log('===========================================\n');

// Read the file
let content = fs.readFileSync(serviceFilePath, 'utf8');
let fixCount = 0;

// Fix 1: Change 'granted' to 'is_granted' in SELECT and WHERE clauses
console.log('Fix 1: Changing ucp.granted to ucp.is_granted...');
const fix1Before = content.match(/SELECT p\.permission_key, ucp\.granted, ucp\.expires_at/);
content = content.replace(
  /SELECT p\.permission_key, ucp\.granted, ucp\.expires_at/g,
  'SELECT p.permission_key, ucp.is_granted, ucp.expires_at'
);
if (fix1Before) {
  console.log('  ✓ Fixed in SELECT clause');
  fixCount++;
}

// Fix 2: Change row.granted to row.is_granted in JavaScript code
console.log('Fix 2: Changing row.granted to row.is_granted...');
const fix2Before = content.match(/if \(row\.granted\)/);
content = content.replace(
  /if \(row\.granted\)/g,
  'if (row.is_granted)'
);
if (fix2Before) {
  console.log('  ✓ Fixed in JavaScript condition');
  fixCount++;
}

// Fix 3: Remove invalid is_active check from USER_CUSTOM_PERMISSIONS
console.log('Fix 3: Removing invalid ucp.is_active filter...');
const fix3Before = content.match(/AND ucp\.is_active = 1/);
content = content.replace(
  /\s+AND ucp\.is_active = 1/g,
  ''
);
if (fix3Before) {
  console.log('  ✓ Removed invalid is_active filter');
  fixCount++;
}

// Write the fixed content back
fs.writeFileSync(serviceFilePath, content, 'utf8');

console.log('\n===========================================');
console.log(`FIXES APPLIED: ${fixCount}`);
console.log('===========================================\n');

console.log('Summary of fixes:');
console.log('  1. Changed ucp.granted → ucp.is_granted (column name)');
console.log('  2. Changed row.granted → row.is_granted (JS variable)');
console.log('  3. Removed ucp.is_active filter (column does not exist)\n');

console.log('✓ Permission service file updated successfully');
console.log('✓ Please restart your backend server for changes to take effect\n');
