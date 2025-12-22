const { connectDB, sql } = require('../config/database');

/**
 * Generate unique requisition number
 * Format: REQ-YYYY-MM-0001
 */
async function generateRequisitionNumber() {
  try {
    const pool = await connectDB();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Get the last requisition number for current month
    const result = await pool.request().query(`
      SELECT TOP 1 requisition_number
      FROM ASSET_REQUISITIONS
      WHERE requisition_number LIKE 'REQ-${year}-${month}-%'
      ORDER BY created_at DESC
    `);

    let sequence = 1;
    if (result.recordset.length > 0) {
      const lastNumber = result.recordset[0].requisition_number;
      const lastSequence = parseInt(lastNumber.split('-')[3]);
      sequence = lastSequence + 1;
    }

    return `REQ-${year}-${month}-${String(sequence).padStart(4, '0')}`;
  } catch (error) {
    console.error('Error generating requisition number:', error);
    throw error;
  }
}

/**
 * Generate unique delivery ticket number
 * Format: DEL-YYYY-MM-0001
 */
async function generateDeliveryTicketNumber() {
  try {
    const pool = await connectDB();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Get the last delivery ticket number for current month
    const result = await pool.request().query(`
      SELECT TOP 1 ticket_number
      FROM ASSET_DELIVERY_TICKETS
      WHERE ticket_number LIKE 'DEL-${year}-${month}-%'
      ORDER BY created_at DESC
    `);

    let sequence = 1;
    if (result.recordset.length > 0) {
      const lastNumber = result.recordset[0].ticket_number;
      const lastSequence = parseInt(lastNumber.split('-')[3]);
      sequence = lastSequence + 1;
    }

    return `DEL-${year}-${month}-${String(sequence).padStart(4, '0')}`;
  } catch (error) {
    console.error('Error generating delivery ticket number:', error);
    throw error;
  }
}

/**
 * Valid status transitions for requisitions
 */
const VALID_STATUS_TRANSITIONS = {
  'pending_dept_head': ['approved_by_dept_head', 'rejected_by_dept_head', 'cancelled'],
  'approved_by_dept_head': ['pending_it_head', 'cancelled'],
  'rejected_by_dept_head': [],
  'pending_it_head': ['approved_by_it_head', 'rejected_by_it_head', 'cancelled'],
  'approved_by_it_head': ['pending_assignment'],
  'rejected_by_it_head': [],
  'pending_assignment': ['assigned', 'cancelled'],
  'assigned': ['delivered'],
  'delivered': ['completed'],
  'completed': [],
  'cancelled': []
};

/**
 * Validate status transition
 * @param {string} currentStatus - Current requisition status
 * @param {string} newStatus - Desired new status
 * @returns {boolean} - True if transition is valid
 */
function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!validTransitions) {
    return false;
  }
  return validTransitions.includes(newStatus);
}

/**
 * Get department head for a department
 * @param {string} departmentId - Department UUID
 * @returns {object|null} - Department head user object
 */
async function getDepartmentHead(departmentId) {
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('departmentId', sql.UniqueIdentifier, departmentId)
      .query(`
        SELECT u.user_id, u.first_name, u.last_name, u.email, u.role
        FROM USER_MASTER u
        WHERE u.department_id = @departmentId
          AND u.role = 'department_head'
          AND u.is_active = 1
        ORDER BY u.created_at ASC
      `);

    if (result.recordset.length > 0) {
      return result.recordset[0];
    }

    // Fallback: Get from DEPARTMENT_MASTER contact_person_id
    const deptResult = await pool.request()
      .input('departmentId', sql.UniqueIdentifier, departmentId)
      .query(`
        SELECT u.user_id, u.first_name, u.last_name, u.email, u.role
        FROM DEPARTMENT_MASTER d
        JOIN USER_MASTER u ON d.contact_person_id = u.user_id
        WHERE d.department_id = @departmentId AND u.is_active = 1
      `);

    return deptResult.recordset.length > 0 ? deptResult.recordset[0] : null;
  } catch (error) {
    console.error('Error getting department head:', error);
    return null;
  }
}

/**
 * Get IT head (any active IT head user)
 * @returns {object|null} - IT head user object
 */
async function getITHead() {
  try {
    const pool = await connectDB();
    const result = await pool.request().query(`
      SELECT TOP 1 user_id, first_name, last_name, email, role
      FROM USER_MASTER
      WHERE role = 'it_head' AND is_active = 1
      ORDER BY created_at ASC
    `);

    return result.recordset.length > 0 ? result.recordset[0] : null;
  } catch (error) {
    console.error('Error getting IT head:', error);
    return null;
  }
}

/**
 * Log requisition approval action to history
 * @param {object} data - Approval history data
 */
async function logApprovalHistory(data) {
  try {
    // Use the provided pool/transaction if available, otherwise get a new connection
    const pool = data.pool || await connectDB();
    await pool.request()
      .input('requisition_id', sql.UniqueIdentifier, data.requisition_id)
      .input('approval_level', sql.VarChar(50), data.approval_level)
      .input('approver_id', sql.UniqueIdentifier, data.approver_id)
      .input('approver_name', sql.NVarChar(200), data.approver_name)
      .input('approver_role', sql.VarChar(50), data.approver_role)
      .input('action', sql.VarChar(50), data.action)
      .input('comments', sql.Text, data.comments || null)
      .input('previous_status', sql.VarChar(50), data.previous_status)
      .input('new_status', sql.VarChar(50), data.new_status)
      .query(`
        INSERT INTO REQUISITION_APPROVAL_HISTORY (
          requisition_id, approval_level, approver_id, approver_name,
          approver_role, action, comments, previous_status, new_status
        ) VALUES (
          @requisition_id, @approval_level, @approver_id, @approver_name,
          @approver_role, @action, @comments, @previous_status, @new_status
        )
      `);

    return true;
  } catch (error) {
    console.error('Error logging approval history:', error);
    throw error;
  }
}

/**
 * Urgency levels with priority mapping
 */
const URGENCY_LEVELS = {
  low: { value: 'low', priority: 1, color: 'green', label: 'Low' },
  medium: { value: 'medium', priority: 2, color: 'blue', label: 'Medium' },
  high: { value: 'high', priority: 3, color: 'orange', label: 'High' },
  critical: { value: 'critical', priority: 4, color: 'red', label: 'Critical' }
};

/**
 * Requisition status labels and colors
 */
const REQUISITION_STATUS = {
  pending_dept_head: { label: 'Pending Department Head', color: 'orange', stage: 1 },
  approved_by_dept_head: { label: 'Approved by Department Head', color: 'blue', stage: 2 },
  rejected_by_dept_head: { label: 'Rejected by Department Head', color: 'red', stage: -1 },
  pending_it_head: { label: 'Pending IT Head', color: 'orange', stage: 3 },
  approved_by_it_head: { label: 'Approved by IT Head', color: 'blue', stage: 4 },
  rejected_by_it_head: { label: 'Rejected by IT Head', color: 'red', stage: -2 },
  pending_assignment: { label: 'Pending Asset Assignment', color: 'purple', stage: 5 },
  assigned: { label: 'Asset Assigned', color: 'cyan', stage: 6 },
  delivered: { label: 'Delivered', color: 'lime', stage: 7 },
  completed: { label: 'Completed', color: 'green', stage: 8 },
  cancelled: { label: 'Cancelled', color: 'gray', stage: -3 }
};

/**
 * Delivery ticket status labels
 */
const DELIVERY_STATUS = {
  pending: { label: 'Pending', color: 'orange' },
  scheduled: { label: 'Scheduled', color: 'blue' },
  in_transit: { label: 'In Transit', color: 'purple' },
  delivered: { label: 'Delivered', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  cancelled: { label: 'Cancelled', color: 'gray' }
};

module.exports = {
  generateRequisitionNumber,
  generateDeliveryTicketNumber,
  isValidStatusTransition,
  getDepartmentHead,
  getITHead,
  logApprovalHistory,
  VALID_STATUS_TRANSITIONS,
  URGENCY_LEVELS,
  REQUISITION_STATUS,
  DELIVERY_STATUS
};
