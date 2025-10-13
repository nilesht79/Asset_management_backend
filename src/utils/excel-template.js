const ExcelJS = require('exceljs');

/**
 * Generate bulk user upload Excel template
 * @param {Array} departments - List of departments with names
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateUserUploadTemplate(departments = []) {
  const workbook = new ExcelJS.Workbook();

  // Create main sheet
  const worksheet = workbook.addWorksheet('Users', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns (* = required field)
  worksheet.columns = [
    { header: 'First Name*', key: 'first_name', width: 15 },
    { header: 'Last Name*', key: 'last_name', width: 15 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Password', key: 'password', width: 15 },
    { header: 'Role*', key: 'role', width: 20 },
    { header: 'Employee ID', key: 'employee_id', width: 15 },
    { header: 'Department Name', key: 'department_name', width: 25 },
    { header: 'Location Name', key: 'location_name', width: 25 },
    { header: 'Is Active', key: 'is_active', width: 12 },
    { header: 'Is VIP', key: 'is_vip', width: 12 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add sample data rows
  worksheet.addRow({
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@company.com',
    password: 'Test@123',
    role: 'employee',
    employee_id: 'EMP-12345678',
    department_name: departments.length > 0 ? departments[0].department_name : 'I.T Department',
    location_name: '', // Optional: Must match existing location name
    is_active: 'true',
    is_vip: 'false'
  });

  worksheet.addRow({
    first_name: 'Jane',
    last_name: 'Smith',
    email: '', // Will auto-generate as jane.smith@company.local
    password: '', // Will auto-generate secure password
    role: 'engineer',
    employee_id: '', // Will auto-generate
    department_name: 'Finance', // Will auto-create if doesn't exist
    location_name: '', // Optional: Must match existing location name
    is_active: 'true',
    is_vip: 'true'
  });

  // Add data validations for Role column (column E)
  worksheet.getColumn(5).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"superadmin,admin,department_head,coordinator,engineer,employee"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Role',
        error: 'Please select a valid role from the list'
      };
    }
  });

  // Add data validations for Is Active column (column H)
  worksheet.getColumn(8).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false'
      };
    }
  });

  // Add data validations for Is VIP column (column I)
  worksheet.getColumn(9).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false'
      };
    }
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 25 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 60 }
  ];

  // Style instructions header
  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  instrHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add instructions
  const instructions = [
    { field: 'First Name', required: 'Yes', description: 'Employee first name (2-50 characters)' },
    { field: 'Last Name', required: 'Yes', description: 'Employee last name (2-50 characters)' },
    { field: 'Email', required: 'No', description: 'Valid email address (auto-generated as firstname.lastname@company.local if left blank)' },
    { field: 'Password', required: 'No', description: 'Minimum 8 characters with uppercase, lowercase, number, and special character (auto-generated if left blank)' },
    { field: 'Role', required: 'Yes', description: 'User role: superadmin, admin, department_head, coordinator, engineer, or employee' },
    { field: 'Employee ID', required: 'No', description: 'Employee ID (auto-generated as T-10000, T-10001, etc. if left blank)' },
    { field: 'Department Name', required: 'No', description: 'Department name (auto-created if doesn\'t exist, leave blank for no department)' },
    { field: 'Location Name', required: 'No', description: 'Location name (must match existing location in system, leave blank for no location)' },
    { field: 'Is Active', required: 'No', description: 'User active status: true or false (default: true)' },
    { field: 'Is VIP', required: 'No', description: 'VIP status: true or false (default: false)' }
  ];

  instructions.forEach(instr => instructionsSheet.addRow(instr));

  // Add available departments section
  if (departments.length > 0) {
    instructionsSheet.addRow({});
    instructionsSheet.addRow({ field: 'AVAILABLE DEPARTMENTS:', required: '', description: '' });
    const deptHeaderRow = instructionsSheet.lastRow;
    deptHeaderRow.font = { bold: true };
    deptHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    departments.forEach(dept => {
      instructionsSheet.addRow({ field: dept.department_name, required: '', description: dept.description || '' });
    });
  }

  // Add notes section
  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'NOTES:', required: '', description: '' });
  const notesRow = instructionsSheet.lastRow;
  notesRow.font = { bold: true };

  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Fields marked with * are required'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Email addresses must be unique'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Department names are case-sensitive and must match exactly'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Invalid rows will be reported with specific error messages'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Sample data is provided in the Users sheet - replace it with your actual data'
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generate bulk asset upload Excel template
 * @param {Object} params - Template parameters
 * @param {number} params.quantity - Number of asset rows to generate
 * @param {Object} params.product - Product details
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateAssetBulkTemplate({ quantity, product }) {
  const workbook = new ExcelJS.Workbook();

  // Create main sheet
  const worksheet = workbook.addWorksheet('Assets', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  worksheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Serial Number*', key: 'serial_number', width: 20 },
    { header: 'Product Name', key: 'product_name', width: 25 },
    { header: 'Product Model', key: 'product_model', width: 20 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'OEM', key: 'oem', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Condition', key: 'condition_status', width: 15 },
    { header: 'Purchase Date', key: 'purchase_date', width: 18 },
    { header: 'Purchase Cost', key: 'purchase_cost', width: 18 },
    { header: 'Warranty End Date', key: 'warranty_end_date', width: 18 },
    { header: 'Notes', key: 'notes', width: 35 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add data rows
  for (let i = 1; i <= quantity; i++) {
    worksheet.addRow({
      row_number: i,
      serial_number: '', // User fills this
      product_name: product?.name || '',
      product_model: product?.model || '',
      category: product?.category_name || '',
      oem: product?.oem_name || '',
      status: 'available',
      condition_status: 'new',
      purchase_date: '',
      purchase_cost: '',
      warranty_end_date: '',
      notes: ''
    });
  }

  // Add data validation for Status column
  worksheet.getColumn(7).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"available,assigned,in_use,under_repair,disposed"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Status',
        error: 'Please select a valid status from the list'
      };
    }
  });

  // Add data validation for Condition column
  worksheet.getColumn(8).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"new,excellent,good,fair,poor"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Condition',
        error: 'Please select a valid condition from the list'
      };
    }
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Parse uploaded asset Excel file
 * @param {Buffer} fileBuffer - Excel file buffer
 * @param {string} productId - Product ID for all assets
 * @returns {Promise<Array>} Parsed asset data
 */
async function parseAssetBulkFile(fileBuffer, productId) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('Assets');
  if (!worksheet) {
    throw new Error('Assets worksheet not found in file');
  }

  const assets = [];
  const errors = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip header row
    if (rowNumber === 1) return;

    const rowData = {
      row_number: row.getCell(1).value,
      serial_number: row.getCell(2).value?.toString().trim() || '',
      status: row.getCell(7).value?.toString().trim() || 'available',
      condition_status: row.getCell(8).value?.toString().trim() || 'new',
      purchase_date: row.getCell(9).value || null,
      purchase_cost: row.getCell(10).value || null,
      warranty_end_date: row.getCell(11).value || null,
      notes: row.getCell(12).value?.toString().trim() || null,
      product_id: productId
    };

    // Validate serial number
    if (!rowData.serial_number) {
      errors.push(`Row ${rowNumber}: Serial number is required`);
      return;
    }

    assets.push(rowData);
  });

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  // Check for duplicates within the file
  const serialNumbers = assets.map(a => a.serial_number);
  const duplicates = serialNumbers.filter((item, index) => serialNumbers.indexOf(item) !== index);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate serial numbers found: ${[...new Set(duplicates)].join(', ')}`);
  }

  return assets;
}

/**
 * Generate legacy asset upload Excel template with reference sheets
 * @param {Object} params - Template parameters
 * @param {Array} params.products - List of products with details
 * @param {Array} params.users - List of users for assignment
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateLegacyAssetTemplate({ products, users }) {
  const workbook = new ExcelJS.Workbook();

  // Create main Assets sheet
  const worksheet = workbook.addWorksheet('Assets', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns for main sheet
  worksheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Serial Number*', key: 'serial_number', width: 20 },
    { header: 'Product Name/ID*', key: 'product', width: 30 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Condition', key: 'condition_status', width: 15 },
    { header: 'Purchase Date', key: 'purchase_date', width: 18 },
    { header: 'Purchase Cost', key: 'purchase_cost', width: 18 },
    { header: 'Warranty End Date', key: 'warranty_end_date', width: 18 },
    { header: 'Assigned To (Email/Employee ID)', key: 'assigned_to', width: 35 },
    { header: 'Notes', key: 'notes', width: 40 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add 3 sample rows
  worksheet.addRow({
    row_number: 1,
    serial_number: 'SN-2023-001',
    product: 'Dell Laptop E7450',
    status: 'available',
    condition_status: 'good',
    purchase_date: '2023-01-15',
    purchase_cost: 45000,
    warranty_end_date: '2026-01-15',
    assigned_to: '',
    notes: 'Legacy asset from old system. Asset tag and tag number will be auto-generated.'
  });

  worksheet.addRow({
    row_number: 2,
    serial_number: 'SN-2023-002',
    product: products.length > 0 ? products[0].id : '',
    status: 'assigned',
    condition_status: 'excellent',
    purchase_date: '2023-03-20',
    purchase_cost: 52000,
    warranty_end_date: '2026-03-20',
    assigned_to: users.length > 0 ? users[0].email : '',
    notes: 'Asset inherits location from assigned user'
  });

  worksheet.addRow({
    row_number: 3,
    serial_number: 'SN-2023-003',
    product: 'HP ProBook 450',
    status: 'in_use',
    condition_status: 'fair',
    purchase_date: '',
    purchase_cost: '',
    warranty_end_date: '',
    assigned_to: '',
    notes: ''
  });

  // Add data validations
  // Status column (now column 4, not 5)
  worksheet.getColumn(4).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"available,assigned,in_use,under_repair,disposed"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Status',
        error: 'Please select a valid status'
      };
    }
  });

  // Condition column (now column 5, not 6)
  worksheet.getColumn(5).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"new,excellent,good,fair,poor"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Condition',
        error: 'Please select a valid condition'
      };
    }
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 70 }
  ];

  // Style instructions header
  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  instrHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add instructions
  const instructions = [
    { field: 'Serial Number', required: 'Yes', description: 'Unique serial number for the asset. Must be unique across all assets.' },
    { field: 'Product Name/ID', required: 'Yes', description: 'Product name OR Product ID from Products reference sheet. System will match both.' },
    { field: 'Status', required: 'No', description: 'Asset status: available, assigned, in_use, under_repair, disposed (default: available)' },
    { field: 'Condition', required: 'No', description: 'Asset condition: new, excellent, good, fair, poor (default: good)' },
    { field: 'Purchase Date', required: 'No', description: 'Purchase date in YYYY-MM-DD format (e.g., 2023-01-15)' },
    { field: 'Purchase Cost', required: 'No', description: 'Purchase cost in numbers only (e.g., 45000)' },
    { field: 'Warranty End Date', required: 'No', description: 'Warranty end date in YYYY-MM-DD format' },
    { field: 'Assigned To', required: 'No', description: 'User email OR Employee ID from Users reference sheet. Asset inherits location from assigned user. Required if status is "assigned".' },
    { field: 'Notes', required: 'No', description: 'Any additional notes or comments about the asset' }
  ];

  instructions.forEach(instr => instructionsSheet.addRow(instr));

  // Add notes section
  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'IMPORTANT NOTES:', required: '', description: '' });
  const notesHeaderRow = instructionsSheet.lastRow;
  notesHeaderRow.font = { bold: true };
  notesHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' }
  };

  const notes = [
    '• Fields marked with * are required',
    '• Serial numbers must be unique across all assets',
    '• Asset Tag and Tag Number will be auto-generated by the system',
    '• You can use either Product Name or Product ID (see Products sheet)',
    '• You can use either User Email or Employee ID for assignment (see Users sheet)',
    '• Assets inherit location from the assigned user - no need to specify location',
    '• If status is "assigned", Assigned To field is required',
    '• Dates should be in YYYY-MM-DD format',
    '• Delete the sample rows before uploading your data',
    '• Maximum 10,000 rows per upload'
  ];

  notes.forEach(note => {
    instructionsSheet.addRow({ field: '', required: '', description: note });
  });

  // Create Products reference sheet
  const productsSheet = workbook.addWorksheet('Products Reference');
  productsSheet.columns = [
    { header: 'Product ID', key: 'id', width: 40 },
    { header: 'Product Name', key: 'name', width: 30 },
    { header: 'Model', key: 'model', width: 20 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'OEM', key: 'oem', width: 20 }
  ];

  const productsHeaderRow = productsSheet.getRow(1);
  productsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  productsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFF6B6B' }
  };
  productsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  products.forEach(product => {
    productsSheet.addRow({
      id: product.id,
      name: product.name,
      model: product.model || '',
      category: product.category_name || '',
      oem: product.oem_name || ''
    });
  });

  // Create Users reference sheet
  const usersSheet = workbook.addWorksheet('Users Reference');
  usersSheet.columns = [
    { header: 'User ID', key: 'id', width: 40 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Employee ID', key: 'employee_id', width: 20 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Department', key: 'department', width: 25 }
  ];

  const usersHeaderRow = usersSheet.getRow(1);
  usersHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  usersHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF95E1D3' }
  };
  usersHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  users.forEach(user => {
    usersSheet.addRow({
      id: user.user_id,
      email: user.email,
      employee_id: user.employee_id || '',
      name: `${user.first_name} ${user.last_name}`,
      department: user.department_name || ''
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Parse and validate legacy asset upload file
 * @param {Buffer} fileBuffer - Excel file buffer
 * @param {Object} referenceData - Reference data for validation
 * @param {Array} referenceData.products - List of products
 * @param {Array} referenceData.users - List of users
 * @param {Array} referenceData.existingSerialNumbers - Existing serial numbers in DB
 * @param {Array} referenceData.existingAssetTags - Existing asset tags in DB
 * @returns {Promise<Object>} Validation results with categorized rows
 */
async function parseLegacyAssetFile(fileBuffer, referenceData) {
  const { products, users, existingSerialNumbers, existingAssetTags } = referenceData;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('Assets');
  if (!worksheet) {
    throw new Error('Assets worksheet not found in file');
  }

  const validRows = [];
  const warningRows = [];
  const errorRows = [];

  const seenSerialNumbers = new Set();

  // Create lookup maps for faster matching
  const productsByName = new Map();
  const productsById = new Map();
  products.forEach(p => {
    productsByName.set(p.name.toLowerCase().trim(), p);
    productsById.set(p.id.toLowerCase(), p);
  });

  const usersByEmail = new Map();
  const usersByEmployeeId = new Map();
  users.forEach(u => {
    usersByEmail.set(u.email.toLowerCase().trim(), u);
    if (u.employee_id) {
      usersByEmployeeId.set(u.employee_id.toLowerCase().trim(), u);
    }
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip header row and sample rows (rows 1-4)
    if (rowNumber <= 1) return;

    const rowData = {
      row_number: rowNumber,
      serial_number: row.getCell(2).value?.toString().trim() || '',
      product_input: row.getCell(3).value?.toString().trim() || '',
      status: row.getCell(4).value?.toString().trim().toLowerCase() || 'available',
      condition_status: row.getCell(5).value?.toString().trim().toLowerCase() || 'good',
      purchase_date: row.getCell(6).value || null,
      purchase_cost: row.getCell(7).value || null,
      warranty_end_date: row.getCell(8).value || null,
      assigned_to_input: row.getCell(9).value?.toString().trim() || '',
      notes: row.getCell(10).value?.toString().trim() || null
    };

    const errors = [];
    const warnings = [];

    // Validate required fields
    if (!rowData.serial_number) {
      errors.push('Serial number is required');
    }
    if (!rowData.product_input) {
      errors.push('Product is required');
    }

    // Check for duplicates within file
    if (rowData.serial_number) {
      if (seenSerialNumbers.has(rowData.serial_number.toLowerCase())) {
        errors.push('Duplicate serial number within file');
      } else {
        seenSerialNumbers.add(rowData.serial_number.toLowerCase());
      }
    }

    // Check for duplicates in database
    if (rowData.serial_number && existingSerialNumbers.includes(rowData.serial_number.toLowerCase())) {
      errors.push('Serial number already exists in database');
    }

    // Match product (by ID or name)
    let product = null;
    if (rowData.product_input) {
      product = productsById.get(rowData.product_input.toLowerCase()) ||
                productsByName.get(rowData.product_input.toLowerCase());

      if (!product) {
        errors.push(`Product not found: ${rowData.product_input}`);
      }
    }

    // Match user if assigned_to is provided (asset will inherit location from user)
    let assignedUser = null;
    if (rowData.assigned_to_input) {
      assignedUser = usersByEmail.get(rowData.assigned_to_input.toLowerCase()) ||
                     usersByEmployeeId.get(rowData.assigned_to_input.toLowerCase());

      if (!assignedUser) {
        errors.push(`User not found: ${rowData.assigned_to_input}`);
      }
    }

    // Validate status
    const validStatuses = ['available', 'assigned', 'in_use', 'under_repair', 'disposed'];
    if (!validStatuses.includes(rowData.status)) {
      errors.push(`Invalid status: ${rowData.status}`);
    }

    // Validate condition
    const validConditions = ['new', 'excellent', 'good', 'fair', 'poor'];
    if (!validConditions.includes(rowData.condition_status)) {
      errors.push(`Invalid condition: ${rowData.condition_status}`);
    }

    // Check if assigned_to is required when status is assigned
    if (rowData.status === 'assigned' && !rowData.assigned_to_input) {
      errors.push('Assigned To is required when status is "assigned"');
    }

    // Warnings for optional fields
    if (!rowData.purchase_date) {
      warnings.push('Purchase date not provided');
    }
    if (!rowData.purchase_cost) {
      warnings.push('Purchase cost not provided');
    }

    // Prepare final row data with resolved IDs
    const finalRowData = {
      ...rowData,
      product_id: product?.id || null,
      product_name: product?.name || rowData.product_input,
      assigned_to: assignedUser?.user_id || null,
      assigned_user_name: assignedUser ? `${assignedUser.first_name} ${assignedUser.last_name}` : null,
      errors,
      warnings
    };

    // Categorize row
    if (errors.length > 0) {
      errorRows.push(finalRowData);
    } else if (warnings.length > 0) {
      warningRows.push(finalRowData);
    } else {
      validRows.push(finalRowData);
    }
  });

  return {
    valid: validRows,
    warnings: warningRows,
    errors: errorRows,
    summary: {
      total: validRows.length + warningRows.length + errorRows.length,
      valid: validRows.length,
      warnings: warningRows.length,
      errors: errorRows.length
    }
  };
}

/**
 * Generate location bulk upload template
 * @param {Object} options - Options containing clients and location types
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateLocationBulkTemplate({ clients, locationTypes }) {
  const workbook = new ExcelJS.Workbook();

  // Create main Locations sheet
  const worksheet = workbook.addWorksheet('Locations', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  worksheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Location Name*', key: 'name', width: 30 },
    { header: 'Address*', key: 'address', width: 40 },
    { header: 'Client Name/ID*', key: 'client', width: 30 },
    { header: 'Location Type Name/ID*', key: 'location_type', width: 25 },
    { header: 'Contact Person*', key: 'contact_person', width: 25 },
    { header: 'Contact Email*', key: 'contact_email', width: 30 },
    { header: 'Contact Phone', key: 'contact_phone', width: 20 },
    { header: 'State', key: 'state_name', width: 20 },
    { header: 'City', key: 'city_name', width: 20 },
    { header: 'Area', key: 'area_name', width: 20 },
    { header: 'Pincode', key: 'pincode', width: 15 },
    { header: 'Parent Location Name', key: 'parent_location', width: 30 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add 3 sample rows
  worksheet.addRow({
    row_number: 1,
    name: 'Mumbai Office - Admin Block',
    address: 'Nariman Point, Mumbai',
    client: clients.length > 0 ? clients[0].client_name : 'Acme Corp',
    location_type: locationTypes.length > 0 ? locationTypes[0].location_type : 'Office',
    contact_person: 'John Doe',
    contact_email: 'john.doe@example.com',
    contact_phone: '+91-9876543210',
    state_name: 'Maharashtra',
    city_name: 'Mumbai',
    area_name: 'Nariman Point',
    pincode: '400021',
    parent_location: ''
  });

  worksheet.addRow({
    row_number: 2,
    name: 'Delhi Office - IT Wing',
    address: 'Connaught Place, New Delhi',
    client: clients.length > 0 ? clients[0].id : '',
    location_type: locationTypes.length > 0 ? locationTypes[0].id : '',
    contact_person: 'Jane Smith',
    contact_email: 'jane.smith@example.com',
    contact_phone: '+91-9876543211',
    state_name: 'Delhi',
    city_name: 'New Delhi',
    area_name: 'Connaught Place',
    pincode: '110001',
    parent_location: ''
  });

  worksheet.addRow({
    row_number: 3,
    name: 'Bangalore Office',
    address: 'Whitefield, Bangalore',
    client: '',
    location_type: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    state_name: 'Karnataka',
    city_name: 'Bangalore',
    area_name: 'Whitefield',
    pincode: '560066',
    parent_location: ''
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 70 }
  ];

  // Style instructions header
  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  instrHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add instructions
  const instructions = [
    { field: 'Location Name', required: 'Yes', description: 'Unique name for the location (e.g., "Mumbai Office - Admin Block")' },
    { field: 'Address', required: 'Yes', description: 'Full address of the location' },
    { field: 'Client Name/ID', required: 'Yes', description: 'Client name OR Client ID from Clients reference sheet' },
    { field: 'Location Type Name/ID', required: 'Yes', description: 'Location type name OR ID from Location Types reference sheet' },
    { field: 'Contact Person', required: 'Yes', description: 'Name of the primary contact person at this location' },
    { field: 'Contact Email', required: 'Yes', description: 'Valid email address of the contact person' },
    { field: 'Contact Phone', required: 'No', description: 'Phone number of the contact person (e.g., +91-9876543210)' },
    { field: 'State', required: 'No', description: 'State name (e.g., Maharashtra, Delhi, Karnataka)' },
    { field: 'City', required: 'No', description: 'City name (e.g., Mumbai, New Delhi, Bangalore)' },
    { field: 'Area', required: 'No', description: 'Area/locality name (e.g., Nariman Point, Connaught Place)' },
    { field: 'Pincode', required: 'No', description: 'Postal pincode (e.g., 400021, 110001)' },
    { field: 'Parent Location', required: 'No', description: 'Name of parent location if this is a sub-location (must exist in the system)' }
  ];

  instructions.forEach(instr => instructionsSheet.addRow(instr));

  // Add notes section
  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'IMPORTANT NOTES:', required: '', description: '' });
  const notesHeaderRow = instructionsSheet.lastRow;
  notesHeaderRow.font = { bold: true };
  notesHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' }
  };

  const notes = [
    '• Fields marked with * are required',
    '• Location names should be unique and descriptive',
    '• You can use either Client Name or Client ID (see Clients sheet)',
    '• You can use either Location Type Name or ID (see Location Types sheet)',
    '• Contact email must be valid and unique',
    '• Parent Location is optional - use it only for sub-locations',
    '• Delete the sample rows before uploading your data',
    '• Maximum 1,000 rows per upload'
  ];

  notes.forEach(note => {
    instructionsSheet.addRow({ field: '', required: '', description: note });
  });

  // Create Clients reference sheet
  const clientsSheet = workbook.addWorksheet('Clients Reference');
  clientsSheet.columns = [
    { header: 'Client ID', key: 'id', width: 40 },
    { header: 'Client Name', key: 'client_name', width: 30 },
    { header: 'Status', key: 'status', width: 15 }
  ];

  const clientsHeaderRow = clientsSheet.getRow(1);
  clientsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  clientsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFF6B6B' }
  };
  clientsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  clients.forEach(client => {
    clientsSheet.addRow({
      id: client.id,
      client_name: client.client_name,
      status: client.is_active ? 'Active' : 'Inactive'
    });
  });

  // Create Location Types reference sheet
  const typesSheet = workbook.addWorksheet('Location Types Reference');
  typesSheet.columns = [
    { header: 'Location Type ID', key: 'id', width: 40 },
    { header: 'Location Type', key: 'location_type', width: 30 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Status', key: 'status', width: 15 }
  ];

  const typesHeaderRow = typesSheet.getRow(1);
  typesHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  typesHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4ECDC4' }
  };
  typesHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  locationTypes.forEach(type => {
    typesSheet.addRow({
      id: type.id,
      location_type: type.location_type,
      description: type.description || '',
      status: type.is_active ? 'Active' : 'Inactive'
    });
  });

  return await workbook.xlsx.writeBuffer();
}

module.exports = {
  generateUserUploadTemplate,
  generateAssetBulkTemplate,
  parseAssetBulkFile,
  generateLegacyAssetTemplate,
  parseLegacyAssetFile,
  generateLocationBulkTemplate
};
