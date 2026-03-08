/**
 * WARRANTY & EOSL EXPIRATION NOTIFICATION JOB
 * Runs daily to check for assets with warranty_end_date or eos_date
 * expiring within configured days (default: 7) and sends in-app
 * notifications to admin, superadmin, coordinator, and department_coordinator users.
 */

const { connectDB, sql } = require('../config/database');
const NotificationModel = require('../models/notification');

const JOB_CONFIG = {
  alertThresholds: [
    { days: 7, priority: 'high', urgency: '' },
    { days: 2, priority: 'high', urgency: 'Urgent: ' },
    { days: 1, priority: 'critical', urgency: 'Critical: ' }
  ],
  enabled: process.env.WARRANTY_ALERT_ENABLED !== 'false',
  targetRoles: ['admin', 'superadmin', 'coordinator', 'department_coordinator']
};

/**
 * Check if a notification was already sent today for a given asset, type, and threshold
 */
const isDuplicateNotification = async (pool, notificationType, assetId, daysBeforeExpiry) => {
  const result = await pool.request()
    .input('notificationType', sql.NVarChar(50), notificationType)
    .input('assetIdPattern', sql.NVarChar(sql.MAX), `%"asset_id":"${assetId}"%`)
    .input('daysPattern', sql.NVarChar(sql.MAX), `%"days_before_expiry":${daysBeforeExpiry}%`)
    .query(`
      SELECT COUNT(*) AS existing_count
      FROM USER_NOTIFICATIONS
      WHERE notification_type = @notificationType
        AND related_data LIKE @assetIdPattern
        AND related_data LIKE @daysPattern
        AND CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)
    `);

  return result.recordset[0].existing_count > 0;
};

/**
 * Format date for display in notification message
 */
const formatDate = (date) => {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Run the warranty/EOSL expiration notification job
 */
const runWarrantyExpirationJob = async () => {
  const startTime = Date.now();

  try {
    console.log('🔔 Starting warranty/EOSL expiration alert job...');
    console.log(`   Alert thresholds: ${JOB_CONFIG.alertThresholds.map(t => t.days + ' days').join(', ')}`);

    if (!JOB_CONFIG.enabled) {
      console.log('⚠️  Warranty alert job is disabled via environment variable');
      return {
        success: true,
        warranty_alerts_sent: 0,
        eosl_alerts_sent: 0,
        skipped: true,
        message: 'Job disabled'
      };
    }

    const pool = await connectDB();

    // Step 1: Fetch target users (admin, superadmin, coordinator, department_coordinator)
    const usersResult = await pool.request().query(`
      SELECT user_id
      FROM USER_MASTER
      WHERE role IN ('admin', 'superadmin', 'coordinator', 'department_coordinator')
        AND is_active = 1
    `);

    const userIds = usersResult.recordset.map(u => u.user_id);
    console.log(`   Target users (admin/coordinator): ${userIds.length}`);

    if (userIds.length === 0) {
      console.log('⚠️  No active admin/coordinator users found. Skipping.');
      return {
        success: true,
        warranty_alerts_sent: 0,
        eosl_alerts_sent: 0,
        target_users: 0,
        message: 'No target users found'
      };
    }

    let warrantyAlertsSent = 0;
    let eoslAlertsSent = 0;
    let skippedDuplicates = 0;

    // Step 2: Process each alert threshold (7 days, 2 days, 1 day)
    for (const threshold of JOB_CONFIG.alertThresholds) {
      const { days, priority, urgency } = threshold;
      const daysLabel = days === 1 ? 'tomorrow' : `in ${days} days`;

      // Query assets with warranty expiring at this threshold
      const warrantyAssets = await pool.request()
        .input('daysAhead', sql.Int, days)
        .query(`
          SELECT id, asset_tag, warranty_end_date
          FROM ASSETS
          WHERE is_active = 1
            AND warranty_end_date IS NOT NULL
            AND CAST(warranty_end_date AS DATE) = CAST(DATEADD(DAY, @daysAhead, GETUTCDATE()) AS DATE)
        `);

      console.log(`   [${days}-day] Warranty expiring: ${warrantyAssets.recordset.length} assets`);

      // Query assets with EOSL expiring at this threshold
      const eoslAssets = await pool.request()
        .input('daysAhead', sql.Int, days)
        .query(`
          SELECT id, asset_tag, eos_date
          FROM ASSETS
          WHERE is_active = 1
            AND eos_date IS NOT NULL
            AND CAST(eos_date AS DATE) = CAST(DATEADD(DAY, @daysAhead, GETUTCDATE()) AS DATE)
        `);

      console.log(`   [${days}-day] EOSL expiring: ${eoslAssets.recordset.length} assets`);

      // Send warranty expiration notifications
      for (const asset of warrantyAssets.recordset) {
        const isDuplicate = await isDuplicateNotification(pool, 'warranty_expiring', asset.id, days);
        if (isDuplicate) {
          skippedDuplicates++;
          continue;
        }

        try {
          await NotificationModel.createBulkNotifications(userIds, {
            ticket_id: null,
            notification_type: 'warranty_expiring',
            title: `${urgency}Warranty Expiring: ${asset.asset_tag}`,
            message: `Asset ${asset.asset_tag} warranty expires ${daysLabel} (${formatDate(asset.warranty_end_date)}). Please review and take action.`,
            priority,
            related_data: {
              asset_id: asset.id,
              asset_tag: asset.asset_tag,
              expiry_date: asset.warranty_end_date,
              days_before_expiry: days,
              alert_type: 'warranty_expiring'
            }
          });
          warrantyAlertsSent++;
        } catch (err) {
          console.error(`   Error sending warranty alert for ${asset.asset_tag} (${days}-day):`, err.message);
        }
      }

      // Send EOSL expiration notifications
      for (const asset of eoslAssets.recordset) {
        const isDuplicate = await isDuplicateNotification(pool, 'eosl_expiring', asset.id, days);
        if (isDuplicate) {
          skippedDuplicates++;
          continue;
        }

        try {
          await NotificationModel.createBulkNotifications(userIds, {
            ticket_id: null,
            notification_type: 'eosl_expiring',
            title: `${urgency}End of Service Life: ${asset.asset_tag}`,
            message: `Asset ${asset.asset_tag} reaches End of Service Life ${daysLabel} (${formatDate(asset.eos_date)}). Plan for replacement or renewal.`,
            priority,
            related_data: {
              asset_id: asset.id,
              asset_tag: asset.asset_tag,
              expiry_date: asset.eos_date,
              days_before_expiry: days,
              alert_type: 'eosl_expiring'
            }
          });
          eoslAlertsSent++;
        } catch (err) {
          console.error(`   Error sending EOSL alert for ${asset.asset_tag} (${days}-day):`, err.message);
        }
      }
    }

    const duration = Date.now() - startTime;

    console.log(`✅ Warranty/EOSL alert job completed in ${duration}ms`);
    console.log(`   Warranty alerts: ${warrantyAlertsSent} assets × ${userIds.length} users`);
    console.log(`   EOSL alerts: ${eoslAlertsSent} assets × ${userIds.length} users`);
    console.log(`   Skipped duplicates: ${skippedDuplicates}`);

    return {
      success: true,
      warranty_alerts_sent: warrantyAlertsSent,
      eosl_alerts_sent: eoslAlertsSent,
      target_users: userIds.length,
      skipped_duplicates: skippedDuplicates,
      duration,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('❌ Warranty/EOSL alert job failed:', error);

    return {
      success: false,
      error: error.message,
      duration,
      timestamp: new Date().toISOString()
    };
  }
};

module.exports = {
  run: runWarrantyExpirationJob,
  config: JOB_CONFIG
};
