const { connectDB, sql } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Find department by name (case-insensitive)
 * @param {string} departmentName - Department name to search for
 * @param {Array} departments - Array of department objects to search in
 * @returns {Object|null} Department object if found, null otherwise
 */
function findDepartmentByName(departmentName, departments = []) {
  if (!departmentName) return null;

  return departments.find(
    d => d.department_name.toLowerCase() === departmentName.toLowerCase()
  ) || null;
}

/**
 * Create a new department in the database
 * @param {string} departmentName - Name of the department to create
 * @param {Object} pool - Database connection pool (optional)
 * @returns {Promise<Object>} Created department object with department_id and department_name
 */
async function createDepartment(departmentName, pool = null) {
  const dbPool = pool || await connectDB();

  const departmentId = uuidv4();

  await dbPool.request()
    .input('departmentId', sql.UniqueIdentifier, departmentId)
    .input('departmentName', sql.VarChar(100), departmentName.trim())
    .input('description', sql.Text, `Auto-created during bulk upload`)
    .query(`
      INSERT INTO DEPARTMENT_MASTER (
        department_id, department_name, description, created_at, updated_at
      )
      VALUES (
        @departmentId, @departmentName, @description, GETUTCDATE(), GETUTCDATE()
      )
    `);

  return {
    department_id: departmentId,
    department_name: departmentName.trim(),
    description: 'Auto-created during bulk upload'
  };
}

/**
 * Get or create a department
 * If department exists, return it. If not, create it.
 *
 * @param {string} departmentName - Name of the department
 * @param {Array} existingDepartments - Array of existing departments
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Department object with department_id and department_name
 */
async function getOrCreateDepartment(departmentName, existingDepartments = [], pool = null) {
  if (!departmentName) return null;

  // Try to find existing department
  const existingDept = findDepartmentByName(departmentName, existingDepartments);

  if (existingDept) {
    return existingDept;
  }

  // Department doesn't exist, create it
  const dbPool = pool || await connectDB();
  const newDepartment = await createDepartment(departmentName, dbPool);

  // Add to existing departments array for future lookups in the same batch
  existingDepartments.push(newDepartment);

  return newDepartment;
}

/**
 * Check if a department name exists in the database
 * @param {string} departmentName - Department name to check
 * @param {Object} pool - Database connection pool (optional)
 * @returns {Promise<boolean>} True if department exists, false otherwise
 */
async function departmentExists(departmentName, pool = null) {
  if (!departmentName) return false;

  const dbPool = pool || await connectDB();

  const result = await dbPool.request()
    .input('departmentName', sql.VarChar(100), departmentName.trim())
    .query(`
      SELECT COUNT(*) as count
      FROM DEPARTMENT_MASTER
      WHERE LOWER(department_name) = LOWER(@departmentName)
    `);

  return result.recordset[0].count > 0;
}

module.exports = {
  findDepartmentByName,
  createDepartment,
  getOrCreateDepartment,
  departmentExists
};
