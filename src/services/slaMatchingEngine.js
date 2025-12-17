/**
 * SLA MATCHING ENGINE SERVICE
 * Matches tickets to appropriate SLA rules based on priority-ordered conditions
 *
 * Matching Priority Order:
 * 1. VIP Override (if user is VIP)
 * 2. Asset Importance (critical > high > medium > low)
 * 3. Ticket Type/Channel combinations
 * 4. Priority-based rules
 * 5. Default fallback rule
 */

const { connectDB, sql } = require('../config/database');

class SlaMatchingEngine {
  /**
   * Find matching SLA rule for a ticket
   * @param {Object} ticketContext - Context containing ticket attributes for matching
   * @returns {Object} Matched SLA rule with escalation rules
   */
  async findMatchingRule(ticketContext) {
    const {
      ticket_id,
      ticket_type,
      ticket_channel,
      priority,
      user_id,
      asset_ids = []
    } = ticketContext;

    try {
      const pool = await connectDB();

      // Step 1: Get user info (check VIP status)
      let isVip = false;
      if (user_id) {
        const userResult = await pool.request()
          .input('userId', sql.UniqueIdentifier, user_id)
          .query('SELECT is_vip FROM USER_MASTER WHERE user_id = @userId');

        if (userResult.recordset.length > 0) {
          isVip = userResult.recordset[0].is_vip || false;
        }
      }

      // Step 2: Get asset importance (highest importance among linked assets)
      let assetImportance = null;
      let assetCategories = [];

      if (asset_ids.length > 0) {
        const assetResult = await pool.request()
          .input('assetIds', sql.NVarChar(sql.MAX), asset_ids.join(','))
          .query(`
            SELECT
              a.importance,
              c.name AS category_name
            FROM assets a
            LEFT JOIN products p ON a.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE a.id IN (SELECT value FROM STRING_SPLIT(@assetIds, ','))
              AND a.is_active = 1
          `);

        const importancePriority = { critical: 4, high: 3, medium: 2, low: 1 };
        let maxPriority = 0;

        for (const asset of assetResult.recordset) {
          if (asset.category_name) {
            assetCategories.push(asset.category_name);
          }
          const priority = importancePriority[asset.importance] || 0;
          if (priority > maxPriority) {
            maxPriority = priority;
            assetImportance = asset.importance;
          }
        }

        assetCategories = [...new Set(assetCategories)]; // Remove duplicates
      }

      // Step 3: Get all active SLA rules ordered by priority
      const rulesResult = await pool.request()
        .query(`
          SELECT
            sr.*,
            bhs.schedule_name,
            bhs.is_24x7,
            hc.calendar_name
          FROM SLA_RULES sr
          LEFT JOIN BUSINESS_HOURS_SCHEDULES bhs ON sr.business_hours_schedule_id = bhs.schedule_id
          LEFT JOIN HOLIDAY_CALENDARS hc ON sr.holiday_calendar_id = hc.calendar_id
          WHERE sr.is_active = 1
          ORDER BY sr.priority_order ASC
        `);

      const rules = rulesResult.recordset;

      // Step 4: Find matching rule
      let matchedRule = null;
      let matchReason = '';

      for (const rule of rules) {
        const match = this.evaluateRule(rule, {
          isVip,
          assetImportance,
          assetCategories,
          ticketType: ticket_type,
          ticketChannel: ticket_channel,
          ticketPriority: priority
        });

        if (match.matches) {
          matchedRule = rule;
          matchReason = match.reason;
          break;
        }
      }

      // Step 5: If no rule matched, use default (highest priority_order)
      if (!matchedRule && rules.length > 0) {
        matchedRule = rules[rules.length - 1];
        matchReason = 'Default SLA rule';
      }

      if (!matchedRule) {
        throw new Error('No SLA rules configured');
      }

      // Step 6: Get escalation rules for matched rule
      const escalationResult = await pool.request()
        .input('ruleId', sql.UniqueIdentifier, matchedRule.rule_id)
        .query(`
          SELECT * FROM ESCALATION_RULES
          WHERE sla_rule_id = @ruleId AND is_active = 1
          ORDER BY escalation_level ASC
        `);

      return {
        rule: matchedRule,
        escalation_rules: escalationResult.recordset,
        match_reason: matchReason,
        match_context: {
          is_vip: isVip,
          asset_importance: assetImportance,
          asset_categories: assetCategories,
          ticket_type,
          ticket_channel,
          ticket_priority: priority
        }
      };
    } catch (error) {
      console.error('Error finding matching SLA rule:', error);
      throw error;
    }
  }

  /**
   * Evaluate if a rule matches the given context
   */
  evaluateRule(rule, context) {
    const {
      isVip,
      assetImportance,
      assetCategories,
      ticketType,
      ticketChannel,
      ticketPriority
    } = context;

    // VIP Override check
    if (rule.is_vip_override) {
      if (isVip) {
        return { matches: true, reason: 'VIP user override' };
      }
      // VIP rules only match VIP users
      return { matches: false };
    }

    let score = 0;
    let reasons = [];

    // Check asset importance (skip if 'all' - treat as wildcard)
    if (rule.applicable_asset_importance && rule.applicable_asset_importance.toLowerCase() !== 'all') {
      const importanceList = rule.applicable_asset_importance.split(',').map(s => s.trim().toLowerCase());
      if (assetImportance && importanceList.includes(assetImportance.toLowerCase())) {
        score += 3;
        reasons.push(`Asset importance: ${assetImportance}`);
      } else if (assetImportance) {
        // Rule specifies importance but asset doesn't match
        return { matches: false };
      }
    } else if (rule.applicable_asset_importance?.toLowerCase() === 'all' && assetImportance) {
      // 'all' matches any asset importance
      score += 1;
      reasons.push(`Asset importance (any): ${assetImportance}`);
    }

    // Check asset categories
    if (rule.applicable_asset_categories) {
      const categoryList = rule.applicable_asset_categories.split(',').map(s => s.trim().toLowerCase());
      const matchingCategories = assetCategories.filter(c =>
        categoryList.includes(c.toLowerCase())
      );
      if (matchingCategories.length > 0) {
        score += 2;
        reasons.push(`Asset category: ${matchingCategories.join(', ')}`);
      } else if (rule.applicable_asset_categories && assetCategories.length > 0) {
        // Rule specifies categories but none match
        return { matches: false };
      }
    }

    // Check user category (skip if 'all' - treat as wildcard)
    if (rule.applicable_user_category && rule.applicable_user_category.toLowerCase() !== 'all') {
      const userCategoryList = rule.applicable_user_category.split(',').map(s => s.trim().toLowerCase());
      // For now, only VIP is a user category
      if (isVip && userCategoryList.includes('vip')) {
        score += 2;
        reasons.push('VIP user');
      } else if (!userCategoryList.includes('regular') && !userCategoryList.includes('all')) {
        // Rule requires specific user category that doesn't match
        return { matches: false };
      }
    }

    // Check ticket type (skip if 'all' - treat as wildcard)
    if (rule.applicable_ticket_type && rule.applicable_ticket_type.toLowerCase() !== 'all') {
      const typeList = rule.applicable_ticket_type.split(',').map(s => s.trim().toLowerCase());
      if (ticketType && typeList.includes(ticketType.toLowerCase())) {
        score += 2;
        reasons.push(`Ticket type: ${ticketType}`);
      } else if (ticketType) {
        // Rule specifies type but doesn't match
        return { matches: false };
      }
    } else if (rule.applicable_ticket_type?.toLowerCase() === 'all' && ticketType) {
      // 'all' matches any ticket type
      score += 1;
      reasons.push(`Ticket type (any): ${ticketType}`);
    }

    // Check ticket channel (skip if 'all' - treat as wildcard)
    if (rule.applicable_ticket_channels && rule.applicable_ticket_channels.toLowerCase() !== 'all') {
      const channelList = rule.applicable_ticket_channels.split(',').map(s => s.trim().toLowerCase());
      if (ticketChannel && channelList.includes(ticketChannel.toLowerCase())) {
        score += 1;
        reasons.push(`Ticket channel: ${ticketChannel}`);
      } else if (ticketChannel) {
        // Rule specifies channel but doesn't match
        return { matches: false };
      }
    }

    // Check ticket priority (skip if 'all' - treat as wildcard)
    if (rule.applicable_priority && rule.applicable_priority.toLowerCase() !== 'all') {
      const priorityList = rule.applicable_priority.split(',').map(s => s.trim().toLowerCase());
      if (ticketPriority && priorityList.includes(ticketPriority.toLowerCase())) {
        score += 1;
        reasons.push(`Priority: ${ticketPriority}`);
      } else if (ticketPriority) {
        // Rule specifies priority but doesn't match
        return { matches: false };
      }
    }

    // If we have any matches or no specific criteria (catch-all rule)
    const hasNoCriteria = !rule.applicable_asset_importance &&
                          !rule.applicable_asset_categories &&
                          !rule.applicable_user_category &&
                          !rule.applicable_ticket_type &&
                          !rule.applicable_ticket_channels;

    if (score > 0 || hasNoCriteria) {
      return {
        matches: true,
        reason: reasons.length > 0 ? reasons.join('; ') : 'Default match',
        score
      };
    }

    return { matches: false };
  }

  /**
   * Re-evaluate SLA for a ticket (when context changes)
   * @param {string} ticketId - Ticket ID
   * @returns {Object} New matched rule or null if unchanged
   */
  async reEvaluateTicketSla(ticketId) {
    try {
      const pool = await connectDB();

      // Get ticket context
      const ticketResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT
            t.ticket_id,
            t.ticket_type,
            t.ticket_channel,
            t.priority,
            t.created_by_user_id AS user_id,
            t.status
          FROM TICKETS t
          WHERE t.ticket_id = @ticketId
        `);

      if (ticketResult.recordset.length === 0) {
        throw new Error('Ticket not found');
      }

      const ticket = ticketResult.recordset[0];

      // Get linked assets
      const assetsResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT asset_id FROM TICKET_ASSETS WHERE ticket_id = @ticketId
        `);

      const assetIds = assetsResult.recordset.map(a => a.asset_id);

      // Find matching rule
      const matchResult = await this.findMatchingRule({
        ticket_id: ticketId,
        ticket_type: ticket.ticket_type,
        ticket_channel: ticket.ticket_channel,
        priority: ticket.priority,
        user_id: ticket.user_id,
        asset_ids: assetIds
      });

      // Check if SLA tracking exists and compare
      const trackingResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT sla_rule_id FROM TICKET_SLA_TRACKING WHERE ticket_id = @ticketId
        `);

      if (trackingResult.recordset.length > 0) {
        const currentRuleId = trackingResult.recordset[0].sla_rule_id;
        if (currentRuleId === matchResult.rule.rule_id) {
          return { changed: false, rule: matchResult.rule };
        }
      }

      return {
        changed: true,
        rule: matchResult.rule,
        escalation_rules: matchResult.escalation_rules,
        match_reason: matchResult.match_reason,
        match_context: matchResult.match_context
      };
    } catch (error) {
      console.error('Error re-evaluating ticket SLA:', error);
      throw error;
    }
  }

  /**
   * Get SLA summary for multiple tickets
   * @param {Array} ticketIds - Array of ticket IDs
   */
  async getBulkSlaSummary(ticketIds) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketIds', sql.NVarChar(sql.MAX), ticketIds.join(','))
        .query(`
          SELECT
            tst.ticket_id,
            tst.sla_status,
            tst.business_elapsed_minutes,
            tst.is_paused,
            sr.rule_name,
            sr.min_tat_minutes,
            sr.avg_tat_minutes,
            sr.max_tat_minutes,
            CASE
              WHEN tst.business_elapsed_minutes >= sr.max_tat_minutes THEN 'breached'
              WHEN tst.business_elapsed_minutes >= sr.avg_tat_minutes THEN 'critical'
              WHEN tst.business_elapsed_minutes >= sr.min_tat_minutes THEN 'warning'
              ELSE 'on_track'
            END AS calculated_status,
            CASE
              WHEN tst.business_elapsed_minutes >= sr.max_tat_minutes THEN 100
              ELSE CAST((tst.business_elapsed_minutes * 100.0 / sr.max_tat_minutes) AS INT)
            END AS percent_used
          FROM TICKET_SLA_TRACKING tst
          INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
          WHERE tst.ticket_id IN (SELECT value FROM STRING_SPLIT(@ticketIds, ','))
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error getting bulk SLA summary:', error);
      throw error;
    }
  }
}

module.exports = new SlaMatchingEngine();
