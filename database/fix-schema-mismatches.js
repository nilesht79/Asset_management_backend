/**
 * FIX ALL SCHEMA MISMATCHES
 * This script identifies and fixes column references that don't match the actual database schema
 */

const fs = require('fs');
const path = require('path');

console.log('\n===========================================');
console.log('FIXING SCHEMA MISMATCHES');
console.log('===========================================\n');

const locationsFilePath = path.join(__dirname, '../src/routes/masters/locations.js');

// Read the file
let content = fs.readFileSync(locationsFilePath, 'utf8');
let fixCount = 0;

console.log('Fixing locations.js...\n');

// Actual locations table columns based on database:
// id, name, address, client_id, location_type_id, contact_person, contact_email,
// contact_phone, parent_location_id, is_active, created_at, updated_at,
// state_name, city_name, pincode, area_name

// Fix 1: Remove non-existent columns from SELECT statements
console.log('Fix 1: Removing non-existent columns from SELECT...');

// Replace the problematic SELECT statement
const oldSelect1 = `SELECT
        l.id, l.name, l.code, l.type, l.address, l.city, l.state, l.country, l.zip_code,
        l.contact_person, l.contact_email, l.contact_phone,
        l.capacity, l.current_occupancy,`;

const newSelect1 = `SELECT
        l.id, l.name, l.address,
        l.state_name, l.city_name, l.pincode, l.area_name,
        l.contact_person, l.contact_email, l.contact_phone,
        l.client_id, l.location_type_id,`;

if (content.includes(oldSelect1)) {
  content = content.replace(oldSelect1, newSelect1);
  console.log('  ✓ Fixed main SELECT statement');
  fixCount++;
}

// Fix 2: Remove capacity and current_occupancy from all other SELECT statements
console.log('\nFix 2: Removing capacity and current_occupancy references...');

content = content.replace(/l\.capacity,\s*/g, '');
content = content.replace(/l\.current_occupancy,\s*/g, '');
content = content.replace(/,\s*l\.capacity/g, '');
content = content.replace(/,\s*l\.current_occupancy/g, '');
console.log('  ✓ Removed capacity and current_occupancy');
fixCount++;

// Fix 3: Replace invalid column names with correct ones
console.log('\nFix 3: Replacing invalid column names...');

const replacements = [
  { old: 'l.code', new: 'l.id' },
  { old: 'l.type', new: 'l.location_type_id' },
  { old: 'l.city', new: 'l.city_name' },
  { old: 'l.state', new: 'l.state_name' },
  { old: 'l.country', new: 'l.area_name' },
  { old: 'l.zip_code', new: 'l.pincode' },
];

replacements.forEach(({ old, new: newCol }) => {
  const regex = new RegExp(old.replace('.', '\\.'), 'g');
  if (content.match(regex)) {
    content = content.replace(regex, newCol);
    console.log(`  ✓ Replaced ${old} → ${newCol}`);
    fixCount++;
  }
});

// Fix 4: Remove capacity and current_occupancy from INSERT/UPDATE statements
console.log('\nFix 4: Fixing INSERT/UPDATE statements...');

// Remove from destructuring
content = content.replace(/current_occupancy\s*=\s*0,/g, '');
content = content.replace(/capacity,/g, '');

// Remove from sql.input statements
content = content.replace(/\.input\('currentOccupancy'[^)]+\)\s*/g, '');
content = content.replace(/\.input\('capacity'[^)]+\)\s*/g, '');

// Remove from INSERT field lists
content = content.replace(/capacity,\s*/g, '');
content = content.replace(/current_occupancy,\s*/g, '');

console.log('  ✓ Cleaned up INSERT/UPDATE statements');
fixCount++;

// Fix 5: Remove from updateableFields
console.log('\nFix 5: Removing from updateableFields...');
content = content.replace(/capacity:\s*{[^}]+},\s*/g, '');
content = content.replace(/current_occupancy:\s*{[^}]+},\s*/g, '');
console.log('  ✓ Removed from updateableFields');
fixCount++;

// Write the fixed content back
fs.writeFileSync(locationsFilePath, content, 'utf8');

console.log('\n===========================================');
console.log(`FIXES APPLIED: ${fixCount}`);
console.log('===========================================\n');

console.log('Summary of fixes in locations.js:');
console.log('  1. Updated SELECT statement with correct columns');
console.log('  2. Removed capacity and current_occupancy references');
console.log('  3. Replaced invalid column names:');
console.log('     - l.code → l.id');
console.log('     - l.type → l.location_type_id');
console.log('     - l.city → l.city_name');
console.log('     - l.state → l.state_name');
console.log('     - l.country → l.area_name');
console.log('     - l.zip_code → l.pincode');
console.log('  4. Cleaned up INSERT/UPDATE statements');
console.log('  5. Removed from updateableFields\n');

console.log('✓ Locations route file updated successfully');
console.log('✓ Please restart your backend server for changes to take effect\n');
