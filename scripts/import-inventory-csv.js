/**
 * CSV Inventory Import Script
 *
 * This script imports inventory data from the CSV file and populates:
 * - OEMs (from MAKE column)
 * - Categories and Subcategories (Hardware -> DESKTOP, LAPTOP, etc.)
 * - Locations (with building and floor)
 * - Departments
 * - Products (with specifications)
 * - Users (from USER NAME)
 * - Assets (with assignments)
 *
 * Usage: node scripts/import-inventory-csv.js
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const sql = require('mssql');

// Database configuration
const dbConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Password123',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'asset_management',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

// Path to CSV file
const CSV_FILE_PATH = path.join(__dirname, '../../excel/UPDATED_INVENTORY_13_OCT_2025.xlsx - Inventory List .csv');

// In-memory caches to avoid duplicate lookups
const caches = {
  oems: new Map(),           // MAKE -> oem_id
  categories: new Map(),     // category name -> category_id
  subcategories: new Map(),  // subcategory name -> subcategory_id
  locations: new Map(),      // location key -> location_id
  departments: new Map(),    // department name -> department_id
  users: new Map(),          // user name -> user_id
  products: new Map()        // product key -> product_id
};

// Statistics
const stats = {
  rowsProcessed: 0,
  oemsCreated: 0,
  categoriesCreated: 0,
  subcategoriesCreated: 0,
  locationsCreated: 0,
  departmentsCreated: 0,
  productsCreated: 0,
  usersCreated: 0,
  assetsCreated: 0,
  assetsUpdated: 0,
  errors: []
};

// Utility: Generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Utility: Clean string
function cleanString(str) {
  if (!str) return null;
  return str.trim().replace(/\s+/g, ' ');
}

// Utility: Parse name into first and last name
function parseName(fullName) {
  if (!fullName) return { firstName: 'Unknown', lastName: 'User' };

  const cleaned = cleanString(fullName);
  const parts = cleaned.split(' ');

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

// Utility: Generate employee ID
function generateEmployeeId(index) {
  return `EMP${String(index).padStart(5, '0')}`;
}

// Utility: Create location key
function createLocationKey(locationName, building, floor) {
  return `${locationName}|${building || ''}|${floor || ''}`.toUpperCase();
}

// Utility: Parse warranty status
function parseWarrantyStatus(warrantyText) {
  if (!warrantyText) return { status: 'unknown', endDate: null };

  const text = warrantyText.trim().toLowerCase();
  if (text.includes('in warranty')) {
    // Assume 3 years warranty from today
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 3);
    return { status: 'in_warranty', endDate };
  } else if (text.includes('out of warranty')) {
    return { status: 'out_of_warranty', endDate: null };
  }

  return { status: 'unknown', endDate: null };
}

// Utility: Build specifications JSON
function buildSpecifications(processor, hdd, ram) {
  const specs = {};

  if (processor) specs.processor = cleanString(processor);
  if (hdd) specs.storage = cleanString(hdd);
  if (ram) specs.ram = cleanString(ram);

  return Object.keys(specs).length > 0 ? JSON.stringify(specs) : null;
}

/**
 * Get or create dummy OEM for products without manufacturer
 */
async function getOrCreateDummyOEM(pool) {
  const dummyOemName = 'Unknown Manufacturer';

  // Check cache
  if (caches.oems.has(dummyOemName)) {
    return caches.oems.get(dummyOemName);
  }

  try {
    // Check if exists
    const checkResult = await pool.request()
      .input('name', sql.VarChar(100), dummyOemName)
      .query('SELECT id FROM oems WHERE name = @name');

    if (checkResult.recordset.length > 0) {
      const oemId = checkResult.recordset[0].id;
      caches.oems.set(dummyOemName, oemId);
      return oemId;
    }

    // Create dummy OEM
    const oemId = generateUUID();
    await pool.request()
      .input('id', sql.UniqueIdentifier, oemId)
      .input('name', sql.VarChar(100), dummyOemName)
      .input('code', sql.VarChar(50), 'UNKNOWN')
      .input('description', sql.VarChar(500), 'Default OEM for products without manufacturer information')
      .input('is_active', sql.Bit, 1)
      .query(`
        INSERT INTO oems (id, name, code, description, is_active, created_at, updated_at)
        VALUES (@id, @name, @code, @description, @is_active, GETDATE(), GETDATE())
      `);

    caches.oems.set(dummyOemName, oemId);
    stats.oemsCreated++;
    console.log(`✓ Created Dummy OEM: ${dummyOemName}`);
    return oemId;
  } catch (error) {
    console.error(`Error creating dummy OEM:`, error.message);
    return null;
  }
}

/**
 * Step 1: Create or get OEM
 */
async function getOrCreateOEM(pool, makeName) {
  if (!makeName || makeName.trim() === '') return null;

  const cleaned = cleanString(makeName);

  // Check cache
  if (caches.oems.has(cleaned)) {
    return caches.oems.get(cleaned);
  }

  try {
    // Check if exists
    const checkResult = await pool.request()
      .input('name', sql.VarChar(100), cleaned)
      .query('SELECT id FROM oems WHERE name = @name');

    if (checkResult.recordset.length > 0) {
      const oemId = checkResult.recordset[0].id;
      caches.oems.set(cleaned, oemId);
      return oemId;
    }

    // Create new OEM
    const oemId = generateUUID();
    const code = cleaned.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
    await pool.request()
      .input('id', sql.UniqueIdentifier, oemId)
      .input('name', sql.VarChar(100), cleaned)
      .input('code', sql.VarChar(50), code)
      .input('description', sql.VarChar(500), `Auto-imported from inventory`)
      .input('is_active', sql.Bit, 1)
      .query(`
        INSERT INTO oems (id, name, code, description, is_active, created_at, updated_at)
        VALUES (@id, @name, @code, @description, @is_active, GETDATE(), GETDATE())
      `);

    caches.oems.set(cleaned, oemId);
    stats.oemsCreated++;
    console.log(`✓ Created OEM: ${cleaned}`);
    return oemId;
  } catch (error) {
    console.error(`Error creating OEM ${cleaned}:`, error.message);
    return null;
  }
}

/**
 * Step 2: Create Hardware category if not exists
 */
async function getOrCreateHardwareCategory(pool) {
  const categoryName = 'Hardware';

  if (caches.categories.has(categoryName)) {
    return caches.categories.get(categoryName);
  }

  try {
    // Check if exists
    const checkResult = await pool.request()
      .input('name', sql.VarChar(100), categoryName)
      .query('SELECT id FROM categories WHERE name = @name');

    if (checkResult.recordset.length > 0) {
      const categoryId = checkResult.recordset[0].id;
      caches.categories.set(categoryName, categoryId);
      return categoryId;
    }

    // Create Hardware category
    const categoryId = generateUUID();
    await pool.request()
      .input('id', sql.UniqueIdentifier, categoryId)
      .input('name', sql.VarChar(100), categoryName)
      .input('description', sql.VarChar(500), 'Hardware and IT Equipment')
      .input('is_active', sql.Bit, 1)
      .query(`
        INSERT INTO categories (id, name, description, is_active, created_at, updated_at)
        VALUES (@id, @name, @description, @is_active, GETDATE(), GETDATE())
      `);

    caches.categories.set(categoryName, categoryId);
    stats.categoriesCreated++;
    console.log(`✓ Created Category: ${categoryName}`);
    return categoryId;
  } catch (error) {
    console.error(`Error creating category ${categoryName}:`, error.message);
    return null;
  }
}

/**
 * Step 3: Create or get subcategory
 */
async function getOrCreateSubcategory(pool, categoryId, subcategoryName) {
  if (!subcategoryName || subcategoryName.trim() === '') return null;

  const cleaned = cleanString(subcategoryName).toUpperCase();
  const cacheKey = `${categoryId}|${cleaned}`;

  if (caches.subcategories.has(cacheKey)) {
    return caches.subcategories.get(cacheKey);
  }

  try {
    // Check if exists
    const checkResult = await pool.request()
      .input('name', sql.VarChar(100), cleaned)
      .input('categoryId', sql.UniqueIdentifier, categoryId)
      .query('SELECT id FROM categories WHERE name = @name AND parent_category_id = @categoryId');

    if (checkResult.recordset.length > 0) {
      const subcategoryId = checkResult.recordset[0].id;
      caches.subcategories.set(cacheKey, subcategoryId);
      return subcategoryId;
    }

    // Create subcategory
    const subcategoryId = generateUUID();
    await pool.request()
      .input('id', sql.UniqueIdentifier, subcategoryId)
      .input('name', sql.VarChar(100), cleaned)
      .input('description', sql.VarChar(500), `${cleaned} equipment`)
      .input('parentId', sql.UniqueIdentifier, categoryId)
      .input('is_active', sql.Bit, 1)
      .query(`
        INSERT INTO categories (id, name, description, parent_category_id, is_active, created_at, updated_at)
        VALUES (@id, @name, @description, @parentId, @is_active, GETDATE(), GETDATE())
      `);

    caches.subcategories.set(cacheKey, subcategoryId);
    stats.subcategoriesCreated++;
    console.log(`✓ Created Subcategory: ${cleaned}`);
    return subcategoryId;
  } catch (error) {
    console.error(`Error creating subcategory ${cleaned}:`, error.message);
    return null;
  }
}

/**
 * Step 4: Create or get location
 */
async function getOrCreateLocation(pool, locationName, building, floor) {
  if (!locationName || locationName.trim() === '') return null;

  const cleanedName = cleanString(locationName);
  const cleanedBuilding = cleanString(building);
  const cleanedFloor = cleanString(floor);
  const locationKey = createLocationKey(cleanedName, cleanedBuilding, cleanedFloor);

  if (caches.locations.has(locationKey)) {
    return caches.locations.get(locationKey);
  }

  try {
    // Check if exists (by name, building, floor combination)
    const checkResult = await pool.request()
      .input('name', sql.VarChar(100), cleanedName)
      .input('building', sql.VarChar(100), cleanedBuilding)
      .input('floor', sql.VarChar(50), cleanedFloor)
      .query(`
        SELECT id FROM locations
        WHERE name = @name
        AND (building = @building OR (building IS NULL AND @building IS NULL))
        AND (floor = @floor OR (floor IS NULL AND @floor IS NULL))
      `);

    if (checkResult.recordset.length > 0) {
      const locationId = checkResult.recordset[0].id;
      caches.locations.set(locationKey, locationId);
      return locationId;
    }

    // Get default client (assume first client)
    const clientResult = await pool.request()
      .query('SELECT TOP 1 id FROM clients WHERE is_active = 1');

    if (clientResult.recordset.length === 0) {
      console.error('No active client found. Please create a client first.');
      return null;
    }
    const clientId = clientResult.recordset[0].id;

    // Get default location type (assume first type)
    const typeResult = await pool.request()
      .query('SELECT TOP 1 id FROM location_types WHERE is_active = 1');

    if (typeResult.recordset.length === 0) {
      console.error('No active location type found. Please create a location type first.');
      return null;
    }
    const locationTypeId = typeResult.recordset[0].id;

    // Create location
    const locationId = generateUUID();
    await pool.request()
      .input('id', sql.UniqueIdentifier, locationId)
      .input('name', sql.VarChar(100), cleanedName)
      .input('address', sql.VarChar(500), cleanedName)
      .input('clientId', sql.UniqueIdentifier, clientId)
      .input('locationTypeId', sql.UniqueIdentifier, locationTypeId)
      .input('contactPerson', sql.VarChar(100), 'Admin')
      .input('contactEmail', sql.VarChar(255), 'admin@example.com')
      .input('building', sql.VarChar(100), cleanedBuilding)
      .input('floor', sql.VarChar(50), cleanedFloor)
      .input('is_active', sql.Bit, 1)
      .query(`
        INSERT INTO locations (
          id, name, address, client_id, location_type_id,
          contact_person, contact_email, building, floor,
          is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @address, @clientId, @locationTypeId,
          @contactPerson, @contactEmail, @building, @floor,
          @is_active, GETDATE(), GETDATE()
        )
      `);

    caches.locations.set(locationKey, locationId);
    stats.locationsCreated++;
    console.log(`✓ Created Location: ${cleanedName} (Building: ${cleanedBuilding}, Floor: ${cleanedFloor})`);
    return locationId;
  } catch (error) {
    console.error(`Error creating location ${cleanedName}:`, error.message);
    return null;
  }
}

/**
 * Step 5: Create or get department
 */
async function getOrCreateDepartment(pool, departmentName) {
  if (!departmentName || departmentName.trim() === '') return null;

  const cleaned = cleanString(departmentName);

  if (caches.departments.has(cleaned)) {
    return caches.departments.get(cleaned);
  }

  try {
    // Check if exists
    const checkResult = await pool.request()
      .input('name', sql.VarChar(100), cleaned)
      .query('SELECT department_id FROM DEPARTMENT_MASTER WHERE department_name = @name');

    if (checkResult.recordset.length > 0) {
      const departmentId = checkResult.recordset[0].department_id;
      caches.departments.set(cleaned, departmentId);
      return departmentId;
    }

    // Create department
    const departmentId = generateUUID();
    await pool.request()
      .input('id', sql.UniqueIdentifier, departmentId)
      .input('name', sql.VarChar(100), cleaned)
      .input('description', sql.VarChar(500), `Auto-imported department`)
      .query(`
        INSERT INTO DEPARTMENT_MASTER (department_id, department_name, description, created_at, updated_at)
        VALUES (@id, @name, @description, GETDATE(), GETDATE())
      `);

    caches.departments.set(cleaned, departmentId);
    stats.departmentsCreated++;
    console.log(`✓ Created Department: ${cleaned}`);
    return departmentId;
  } catch (error) {
    console.error(`Error creating department ${cleaned}:`, error.message);
    return null;
  }
}

/**
 * Step 6: Create or get product
 */
async function getOrCreateProduct(pool, model, oemId, categoryId, subcategoryId, specifications) {
  if (!model || model.trim() === '') return null;

  const cleaned = cleanString(model);

  // If no OEM provided, use dummy OEM
  if (!oemId) {
    oemId = await getOrCreateDummyOEM(pool);
    if (!oemId) {
      console.log(`⚠ Skipping product ${cleaned} - failed to create dummy OEM`);
      return null;
    }
  }

  const productKey = `${cleaned}|${oemId}`;

  if (caches.products.has(productKey)) {
    return caches.products.get(productKey);
  }

  try {
    // Check if exists
    const checkResult = await pool.request()
      .input('model', sql.VarChar(100), cleaned)
      .input('oemId', sql.UniqueIdentifier, oemId)
      .query(`
        SELECT id FROM products
        WHERE model = @model AND oem_id = @oemId
      `);

    if (checkResult.recordset.length > 0) {
      const productId = checkResult.recordset[0].id;
      caches.products.set(productKey, productId);
      return productId;
    }

    // Create product
    const productId = generateUUID();
    await pool.request()
      .input('id', sql.UniqueIdentifier, productId)
      .input('name', sql.VarChar(255), cleaned)
      .input('model', sql.VarChar(100), cleaned)
      .input('categoryId', sql.UniqueIdentifier, categoryId)
      .input('subcategoryId', sql.UniqueIdentifier, subcategoryId)
      .input('oemId', sql.UniqueIdentifier, oemId)
      .input('specifications', sql.Text, specifications)
      .input('is_active', sql.Bit, 1)
      .query(`
        INSERT INTO products (
          id, name, model, category_id, subcategory_id, oem_id,
          specifications, is_active, created_at, updated_at
        )
        VALUES (
          @id, @name, @model, @categoryId, @subcategoryId, @oemId,
          @specifications, @is_active, GETDATE(), GETDATE()
        )
      `);

    caches.products.set(productKey, productId);
    stats.productsCreated++;
    console.log(`✓ Created Product: ${cleaned}`);
    return productId;
  } catch (error) {
    console.error(`Error creating product ${cleaned}:`, error.message);
    return null;
  }
}

/**
 * Step 7: Create or get user
 */
async function getOrCreateUser(pool, userName, employeeId, departmentId, locationId, index) {
  if (!userName || userName.trim() === '') return null;

  const cleaned = cleanString(userName);

  // Skip special users
  const skipUsers = ['WITH IT', 'USER NOT FOUND', 'NO USER', 'COMMON PC', 'COMMON PRINTERS', 'WITH PROCUREMENT DEPARTMENT'];
  if (skipUsers.includes(cleaned.toUpperCase())) {
    return null;
  }

  if (caches.users.has(cleaned)) {
    return caches.users.get(cleaned);
  }

  try {
    // Parse name
    const { firstName, lastName } = parseName(cleaned);

    // Generate email
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`.replace(/\s+/g, '');

    // Check if user exists by name
    const checkResult = await pool.request()
      .input('firstName', sql.VarChar(100), firstName)
      .input('lastName', sql.VarChar(100), lastName)
      .query(`
        SELECT user_id FROM USER_MASTER
        WHERE first_name = @firstName AND last_name = @lastName
      `);

    if (checkResult.recordset.length > 0) {
      const userId = checkResult.recordset[0].user_id;
      caches.users.set(cleaned, userId);
      return userId;
    }

    // Create user
    const userId = generateUUID();
    const empId = employeeId || generateEmployeeId(index);

    await pool.request()
      .input('id', sql.UniqueIdentifier, userId)
      .input('email', sql.VarChar(255), email)
      .input('passwordHash', sql.VarChar(255), 'IMPORTED_NO_PASSWORD')
      .input('firstName', sql.VarChar(100), firstName)
      .input('lastName', sql.VarChar(100), lastName)
      .input('employeeId', sql.VarChar(50), empId)
      .input('role', sql.VarChar(50), 'employee')
      .input('departmentId', sql.UniqueIdentifier, departmentId)
      .input('locationId', sql.UniqueIdentifier, locationId)
      .input('is_active', sql.Bit, 1)
      .input('registration_type', sql.VarChar(20), 'imported')
      .input('email_verified', sql.Bit, 0)
      .input('user_status', sql.VarChar(20), 'active')
      .query(`
        INSERT INTO USER_MASTER (
          user_id, email, password_hash, first_name, last_name, employee_id,
          role, department_id, location_id, is_active, registration_type,
          email_verified, user_status, created_at, updated_at
        )
        VALUES (
          @id, @email, @passwordHash, @firstName, @lastName, @employeeId,
          @role, @departmentId, @locationId, @is_active, @registration_type,
          @email_verified, @user_status, GETDATE(), GETDATE()
        )
      `);

    caches.users.set(cleaned, userId);
    stats.usersCreated++;
    console.log(`✓ Created User: ${firstName} ${lastName} (${empId})`);
    return userId;
  } catch (error) {
    console.error(`Error creating user ${cleaned}:`, error.message);
    return null;
  }
}

/**
 * Step 8: Create or update asset
 */
async function createOrUpdateAsset(pool, productId, userId, serialNumber, warrantyInfo, assetNumberCounter) {
  if (!productId) return assetNumberCounter;

  try {
    // Clean serial number - set to NULL if empty to avoid unique constraint issues
    const cleanedSerial = serialNumber && serialNumber.trim() !== '' ? cleanString(serialNumber) : null;

    // Determine status
    let assetStatus = 'available';
    if (userId) {
      assetStatus = 'assigned';
    } else if (warrantyInfo.status === 'out_of_warranty') {
      assetStatus = 'retired';
    }

    // Check if asset exists by serial number (only if serial number is not null)
    let existingAsset = null;
    if (cleanedSerial) {
      const checkResult = await pool.request()
        .input('serialNumber', sql.VarChar(100), cleanedSerial)
        .query(`
          SELECT id, asset_tag FROM assets
          WHERE serial_number = @serialNumber
        `);

      if (checkResult.recordset.length > 0) {
        existingAsset = checkResult.recordset[0];
      }
    }

    if (existingAsset) {
      // Update existing asset
      await pool.request()
        .input('id', sql.UniqueIdentifier, existingAsset.id)
        .input('productId', sql.UniqueIdentifier, productId)
        .input('assignedTo', sql.UniqueIdentifier, userId)
        .input('status', sql.VarChar(20), assetStatus)
        .input('warrantyEndDate', sql.Date, warrantyInfo.endDate)
        .query(`
          UPDATE assets
          SET
            product_id = @productId,
            assigned_to = @assignedTo,
            status = @status,
            warranty_end_date = @warrantyEndDate,
            updated_at = GETDATE()
          WHERE id = @id
        `);

      stats.assetsUpdated = (stats.assetsUpdated || 0) + 1;
      console.log(`↻ Updated Asset: ${existingAsset.asset_tag} (Serial: ${cleanedSerial})`);
      return assetNumberCounter; // Don't increment counter for updates
    } else {
      // Create new asset - use the counter for asset tag
      const assetId = generateUUID();
      const assetTag = `AST-${String(assetNumberCounter).padStart(6, '0')}`;

      await pool.request()
        .input('id', sql.UniqueIdentifier, assetId)
        .input('assetTag', sql.VarChar(50), assetTag)
        .input('productId', sql.UniqueIdentifier, productId)
        .input('assignedTo', sql.UniqueIdentifier, userId)
        .input('serialNumber', sql.VarChar(100), cleanedSerial)
        .input('tagNo', sql.VarChar(100), assetTag)
        .input('status', sql.VarChar(20), assetStatus)
        .input('conditionStatus', sql.VarChar(20), 'working')
        .input('warrantyEndDate', sql.Date, warrantyInfo.endDate)
        .input('is_active', sql.Bit, 1)
        .query(`
          INSERT INTO assets (
            id, asset_tag, product_id, assigned_to, serial_number, tag_no,
            status, condition_status, warranty_end_date, is_active,
            created_at, updated_at
          )
          VALUES (
            @id, @assetTag, @productId, @assignedTo, @serialNumber, @tagNo,
            @status, @conditionStatus, @warrantyEndDate, @is_active,
            GETDATE(), GETDATE()
          )
        `);

      stats.assetsCreated++;
      return assetNumberCounter + 1; // Increment counter for next asset
    }
  } catch (error) {
    console.error(`Error creating/updating asset:`, error.message);
    stats.errors.push({ row: assetNumberCounter, error: error.message });
    return assetNumberCounter; // Don't increment on error
  }
}

/**
 * Main import function
 */
async function importCSV() {
  let pool;

  try {
    console.log('='.repeat(60));
    console.log('CSV INVENTORY IMPORT SCRIPT');
    console.log('='.repeat(60));
    console.log(`\nReading CSV file: ${CSV_FILE_PATH}\n`);

    // Check if file exists
    if (!fs.existsSync(CSV_FILE_PATH)) {
      console.error(`ERROR: CSV file not found at ${CSV_FILE_PATH}`);
      process.exit(1);
    }

    // Connect to database
    console.log('Connecting to database...');
    pool = await sql.connect(dbConfig);
    console.log('✓ Database connected\n');

    // Get Hardware category (create if not exists)
    console.log('Setting up Hardware category...');
    const hardwareCategoryId = await getOrCreateHardwareCategory(pool);
    if (!hardwareCategoryId) {
      console.error('ERROR: Failed to create/get Hardware category');
      process.exit(1);
    }
    console.log('✓ Hardware category ready\n');

    // Get the current max asset tag number to continue from
    console.log('Getting next asset tag number...');
    const maxTagResult = await pool.request()
      .query(`
        SELECT ISNULL(MAX(CAST(SUBSTRING(asset_tag, 5, LEN(asset_tag)) AS INT)), 0) as max_number
        FROM assets
        WHERE asset_tag LIKE 'AST-%'
      `);
    let nextAssetNumber = (maxTagResult.recordset[0].max_number || 0) + 1;
    console.log(`✓ Next asset tag will be: AST-${String(nextAssetNumber).padStart(6, '0')}\n`);

    // Read and process CSV
    const rows = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
          rows.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Found ${rows.length} rows in CSV\n`);
    console.log('Starting import...\n');

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      stats.rowsProcessed++;

      if (stats.rowsProcessed % 50 === 0) {
        console.log(`Progress: ${stats.rowsProcessed}/${rows.length} rows processed...`);
      }

      try {
        // Extract data from row
        const userName = row['USER NAME'];
        const empId = row['EMP ID'];
        const department = row['DEPARTMENT'];
        const location = row['LOCATIONS'];
        const building = row['BUILDING'];
        const floor = row['FLOOR'];
        const hardware = row['HARDWARE'];
        const make = row['MAKE'];
        const model = row['MODEL'];
        const serialNumber = row['SERIAL NUMBER'];
        const processor = row['PROCESSOR'];
        const hdd = row['HDD'];
        const ram = row['RAM'];
        const warranty = row['Warrenty'];

        // Skip if essential data is missing
        if (!model || !hardware) continue;

        // Step 1: Get or create OEM
        const oemId = await getOrCreateOEM(pool, make);

        // Step 2: Get or create subcategory
        const subcategoryId = await getOrCreateSubcategory(pool, hardwareCategoryId, hardware);

        // Step 3: Get or create location
        const locationId = await getOrCreateLocation(pool, location, building, floor);

        // Step 4: Get or create department
        const departmentId = await getOrCreateDepartment(pool, department);

        // Step 5: Build specifications
        const specifications = buildSpecifications(processor, hdd, ram);

        // Step 6: Get or create product
        const productId = await getOrCreateProduct(
          pool,
          model,
          oemId,
          hardwareCategoryId,
          subcategoryId,
          specifications
        );

        // Step 7: Get or create user
        const userId = await getOrCreateUser(
          pool,
          userName,
          empId,
          departmentId,
          locationId,
          i + 1
        );

        // Step 8: Parse warranty
        const warrantyInfo = parseWarrantyStatus(warranty);

        // Step 9: Create or update asset
        nextAssetNumber = await createOrUpdateAsset(pool, productId, userId, serialNumber, warrantyInfo, nextAssetNumber);

      } catch (error) {
        console.error(`Error processing row ${i + 1}:`, error.message);
        stats.errors.push({ row: i + 1, error: error.message });
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('IMPORT COMPLETED');
    console.log('='.repeat(60));
    console.log(`\nRows processed: ${stats.rowsProcessed}`);
    console.log(`\nCreated:`);
    console.log(`  - OEMs: ${stats.oemsCreated}`);
    console.log(`  - Categories: ${stats.categoriesCreated}`);
    console.log(`  - Subcategories: ${stats.subcategoriesCreated}`);
    console.log(`  - Locations: ${stats.locationsCreated}`);
    console.log(`  - Departments: ${stats.departmentsCreated}`);
    console.log(`  - Products: ${stats.productsCreated}`);
    console.log(`  - Users: ${stats.usersCreated}`);
    console.log(`  - Assets Created: ${stats.assetsCreated}`);
    console.log(`  - Assets Updated: ${stats.assetsUpdated}`);

    if (stats.errors.length > 0) {
      console.log(`\nErrors: ${stats.errors.length}`);
      console.log('First 10 errors:');
      stats.errors.slice(0, 10).forEach(err => {
        console.log(`  Row ${err.row}: ${err.error}`);
      });
    }

    console.log('\n' + '='.repeat(60));

  } catch (error) {
    console.error('\nFATAL ERROR:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\nDatabase connection closed');
    }
  }
}

// Run the import
importCSV().catch(console.error);
