/**
 * Scheduled Job: Auto-convert overdue standby assignments to permanent
 * Runs daily to check for assignments past expected return date
 */

const { connectDB, sql } = require('../config/database');

// Number of days after expected return date to auto-convert
const AUTO_CONVERT_DAYS_AFTER_DUE = 30;

/**
 * Check and auto-convert overdue standby assignments
 */
const autoConvertOverdueAssignments = async () => {
  let pool;

  try {
    console.log('[Standby Auto-Conversion] Job started at', new Date().toISOString());

    pool = await connectDB();

    // Find active assignments that are overdue for return
    const overdueAssignments = await pool.request()
      .input('daysOverdue', sql.Int, AUTO_CONVERT_DAYS_AFTER_DUE)
      .query(`
        SELECT
          sa.id,
          sa.standby_asset_id,
          sa.user_id,
          sa.expected_return_date,
          sa.assigned_date,
          standby.asset_tag as standby_asset_tag,
          u.first_name + ' ' + u.last_name as user_name,
          DATEDIFF(DAY, sa.expected_return_date, GETUTCDATE()) as days_overdue
        FROM STANDBY_ASSIGNMENTS sa
        INNER JOIN assets standby ON sa.standby_asset_id = standby.id
        INNER JOIN USER_MASTER u ON sa.user_id = u.user_id
        WHERE sa.status = 'active'
          AND sa.expected_return_date IS NOT NULL
          AND DATEDIFF(DAY, sa.expected_return_date, GETUTCDATE()) >= @daysOverdue
      `);

    if (overdueAssignments.recordset.length === 0) {
      console.log('[Standby Auto-Conversion] No overdue assignments found');
      return {
        success: true,
        converted: 0,
        message: 'No overdue assignments found'
      };
    }

    console.log(`[Standby Auto-Conversion] Found ${overdueAssignments.recordset.length} overdue assignments`);

    const results = {
      success: [],
      failed: []
    };

    // Process each overdue assignment
    for (const assignment of overdueAssignments.recordset) {
      const transaction = pool.transaction();

      try {
        await transaction.begin();

        // Convert standby asset to permanent assignment
        await transaction.request()
          .input('assetId', sql.UniqueIdentifier, assignment.standby_asset_id)
          .query(`
            UPDATE assets
            SET is_standby_asset = 0,
                standby_available = 0,
                updated_at = GETUTCDATE()
            WHERE id = @assetId
          `);

        // Update assignment status
        await transaction.request()
          .input('assignmentId', sql.UniqueIdentifier, assignment.id)
          .input('notes', sql.Text, `Auto-converted to permanent after ${assignment.days_overdue} days overdue (expected return: ${assignment.expected_return_date})`)
          .query(`
            UPDATE STANDBY_ASSIGNMENTS
            SET status = 'permanent',
                return_notes = @notes,
                made_permanent_at = GETUTCDATE()
            WHERE id = @assignmentId
          `);

        // Log movement
        await transaction.request()
          .input('assetId', sql.UniqueIdentifier, assignment.standby_asset_id)
          .input('assetTag', sql.VarChar(50), assignment.standby_asset_tag)
          .input('movementType', sql.VarChar(20), 'assigned')
          .input('status', sql.VarChar(20), 'assigned')
          .input('reason', sql.Text, `Standby assignment auto-converted to permanent after ${assignment.days_overdue} days overdue`)
          .input('performedByName', sql.NVarChar(200), 'System (Auto-Conversion Job)')
          .query(`
            INSERT INTO ASSET_MOVEMENTS (
              asset_id, asset_tag, movement_type, status,
              reason, performed_by_name, movement_date, created_at
            )
            VALUES (
              @assetId, @assetTag, @movementType, @status,
              @reason, @performedByName, GETUTCDATE(), GETUTCDATE()
            )
          `);

        await transaction.commit();

        results.success.push({
          assignment_id: assignment.id,
          standby_asset_tag: assignment.standby_asset_tag,
          user_name: assignment.user_name,
          days_overdue: assignment.days_overdue
        });

        console.log(`[Standby Auto-Conversion] ✓ Converted: ${assignment.standby_asset_tag} for ${assignment.user_name} (${assignment.days_overdue} days overdue)`);

      } catch (error) {
        await transaction.rollback();

        results.failed.push({
          assignment_id: assignment.id,
          standby_asset_tag: assignment.standby_asset_tag,
          user_name: assignment.user_name,
          error: error.message
        });

        console.error(`[Standby Auto-Conversion] ✗ Failed: ${assignment.standby_asset_tag} for ${assignment.user_name}`, error.message);
      }
    }

    console.log(`[Standby Auto-Conversion] Job completed: ${results.success.length} converted, ${results.failed.length} failed`);

    return {
      success: true,
      converted: results.success.length,
      failed: results.failed.length,
      details: results
    };

  } catch (error) {
    console.error('[Standby Auto-Conversion] Job failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send notifications for assignments approaching due date
 */
const notifyApproachingDueDate = async () => {
  try {
    console.log('[Standby Notifications] Checking for assignments approaching due date...');

    const pool = await connectDB();

    // Find assignments due in next 3 days
    const approachingDue = await pool.request()
      .query(`
        SELECT
          sa.id,
          sa.standby_asset_id,
          sa.user_id,
          sa.expected_return_date,
          standby.asset_tag as standby_asset_tag,
          original.asset_tag as original_asset_tag,
          u.first_name + ' ' + u.last_name as user_name,
          u.email as user_email,
          DATEDIFF(DAY, GETUTCDATE(), sa.expected_return_date) as days_until_due
        FROM STANDBY_ASSIGNMENTS sa
        INNER JOIN assets standby ON sa.standby_asset_id = standby.id
        LEFT JOIN assets original ON sa.original_asset_id = original.id
        INNER JOIN USER_MASTER u ON sa.user_id = u.user_id
        WHERE sa.status = 'active'
          AND sa.expected_return_date IS NOT NULL
          AND DATEDIFF(DAY, GETUTCDATE(), sa.expected_return_date) BETWEEN 0 AND 3
      `);

    console.log(`[Standby Notifications] Found ${approachingDue.recordset.length} assignments approaching due date`);

    // TODO: Integrate with notification system
    // For now, just log the notifications that would be sent
    approachingDue.recordset.forEach(assignment => {
      console.log(`[Standby Notifications] NOTIFY: ${assignment.user_name} (${assignment.user_email})`);
      console.log(`  - Standby: ${assignment.standby_asset_tag}`);
      console.log(`  - Original: ${assignment.original_asset_tag || 'N/A'}`);
      console.log(`  - Due in: ${assignment.days_until_due} days`);
    });

    return {
      success: true,
      notifications: approachingDue.recordset.length
    };

  } catch (error) {
    console.error('[Standby Notifications] Failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check standby pool levels and send alerts if low
 */
const checkStandbyPoolLevels = async () => {
  try {
    console.log('[Standby Pool Check] Checking pool levels...');

    const pool = await connectDB();

    // Get available standby assets by category
    const poolLevels = await pool.request().query(`
      SELECT
        cat.name as category_name,
        COUNT(*) as available_count
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      WHERE a.is_active = 1
        AND a.is_standby_asset = 1
        AND a.standby_available = 1
        AND a.assigned_to IS NULL
      GROUP BY cat.name
      ORDER BY available_count ASC
    `);

    // Define minimum thresholds per category
    const MIN_THRESHOLD = 2;

    const lowCategories = poolLevels.recordset.filter(
      level => level.available_count < MIN_THRESHOLD
    );

    if (lowCategories.length > 0) {
      console.log('[Standby Pool Check] ⚠️ LOW POOL ALERT:');
      lowCategories.forEach(cat => {
        console.log(`  - ${cat.category_name}: ${cat.available_count} available (threshold: ${MIN_THRESHOLD})`);
      });

      // TODO: Send alert to admins
    } else {
      console.log('[Standby Pool Check] All categories have sufficient standby assets');
    }

    return {
      success: true,
      low_categories: lowCategories.length,
      details: lowCategories
    };

  } catch (error) {
    console.error('[Standby Pool Check] Failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Main job runner - run all standby-related jobs
 */
const runStandbyJobs = async () => {
  console.log('\n========================================');
  console.log('STANDBY JOBS RUNNER');
  console.log('Started at:', new Date().toISOString());
  console.log('========================================\n');

  try {
    // Run auto-conversion job
    const conversionResult = await autoConvertOverdueAssignments();

    // Run notification job
    const notificationResult = await notifyApproachingDueDate();

    // Run pool level check
    const poolCheckResult = await checkStandbyPoolLevels();

    console.log('\n========================================');
    console.log('STANDBY JOBS COMPLETED');
    console.log('========================================');
    console.log('Auto-Conversion:', conversionResult.converted || 0, 'converted');
    console.log('Notifications:', notificationResult.notifications || 0, 'sent');
    console.log('Pool Check:', poolCheckResult.low_categories || 0, 'low categories');
    console.log('========================================\n');

    return {
      success: true,
      results: {
        conversion: conversionResult,
        notifications: notificationResult,
        poolCheck: poolCheckResult
      }
    };

  } catch (error) {
    console.error('[Standby Jobs] FAILED:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Export functions
module.exports = {
  autoConvertOverdueAssignments,
  notifyApproachingDueDate,
  checkStandbyPoolLevels,
  runStandbyJobs
};

// If running directly (for testing)
if (require.main === module) {
  runStandbyJobs()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Job failed:', error);
      process.exit(1);
    });
}
