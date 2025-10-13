const ExcelJS = require('exceljs');

/**
 * Generate credentials export Excel file
 * Creates a formatted Excel file with user credentials for distribution
 *
 * @param {Array} users - Array of user objects with credentials
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateCredentialsExport(users) {
  const workbook = new ExcelJS.Workbook();

  // Main credentials sheet
  const worksheet = workbook.addWorksheet('User Credentials', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  worksheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 35 },
    { header: 'Password', key: 'password', width: 20 },
    { header: 'Employee ID', key: 'employee_id', width: 18 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Status', key: 'status', width: 12 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0066CC' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 30;

  // Add user data
  users.forEach((user, index) => {
    const row = worksheet.addRow({
      name: user.name,
      email: user.email,
      password: user.password,
      employee_id: user.employeeId,
      role: user.role || 'N/A',
      status: user.passwordGenerated ? 'Auto-Generated' : 'User Provided'
    });

    // Alternate row colors
    if (index % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0F0F0' }
      };
    }

    // Highlight auto-generated passwords
    if (user.passwordGenerated) {
      row.getCell(3).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEB3B' } // Yellow highlight
      };
    }
  });

  // Add instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'IMPORTANT INSTRUCTIONS', key: 'instructions', width: 80 }
  ];

  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD32F2F' }
  };
  instrHeaderRow.height = 35;

  const instructions = [
    '',
    'SECURITY NOTICE:',
    '• This file contains sensitive user credentials',
    '• Store this file securely and delete after distribution',
    '• Do NOT share this file via unsecured channels',
    '• Do NOT store passwords in plain text for extended periods',
    '',
    'DISTRIBUTION GUIDELINES:',
    '• Send credentials to users via secure, individual channels',
    '• Request users to change their password upon first login',
    '• Inform users about password requirements',
    '',
    'PASSWORD REQUIREMENTS:',
    '• Minimum 8 characters',
    '• Must contain uppercase letter (A-Z)',
    '• Must contain lowercase letter (a-z)',
    '• Must contain number (0-9)',
    '• Must contain special character (@$!%*?&)',
    '',
    'AUTO-GENERATED PASSWORDS:',
    '• Passwords highlighted in yellow were auto-generated',
    '• Pattern: FirstName@YearRandomLastInitial (e.g., John@202445D)',
    '• These passwords meet all security requirements',
    '',
    'NEXT STEPS:',
    '1. Distribute credentials securely to each user',
    '2. Instruct users to login and change their password',
    '3. Delete this file after all credentials are distributed',
    '4. Monitor first-time login activity',
    '',
    `Generated on: ${new Date().toLocaleString()}`,
    `Total Users: ${users.length}`,
    `Auto-Generated Passwords: ${users.filter(u => u.passwordGenerated).length}`
  ];

  instructions.forEach((instr, index) => {
    const row = instructionsSheet.addRow({ instructions: instr });

    if (instr.startsWith('SECURITY') || instr.startsWith('DISTRIBUTION') ||
        instr.startsWith('PASSWORD') || instr.startsWith('AUTO-GENERATED') ||
        instr.startsWith('NEXT STEPS')) {
      row.font = { bold: true, size: 12 };
    }

    if (instr.startsWith('•')) {
      row.getCell(1).alignment = { indent: 1 };
    }

    if (index === instructions.length - 3 || index === instructions.length - 2 || index === instructions.length - 1) {
      row.font = { italic: true, color: { argb: 'FF666666' } };
    }
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Generate CSV format for credentials (simpler alternative)
 * @param {Array} users - Array of user objects with credentials
 * @returns {string} CSV content
 */
function generateCredentialsCSV(users) {
  const headers = ['Name', 'Email', 'Password', 'Employee ID', 'Role', 'Password Generated'];
  const rows = users.map(user => [
    user.name,
    user.email,
    user.password,
    user.employeeId,
    user.role || 'N/A',
    user.passwordGenerated ? 'Yes' : 'No'
  ]);

  const csvLines = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ];

  return csvLines.join('\n');
}

module.exports = {
  generateCredentialsExport,
  generateCredentialsCSV
};
