/**
 * DATABASE PERMISSION CHECKER SCRIPT
 * This script checks the current state of the permission system in the database
 * Run with: node database/check-permissions.js
 */

require('dotenv').config();
const sql = require('mssql');

// Database configuration from .env
const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true
  }
};

async function checkPermissions() {
  let pool;

  try {
    console.log('\n===========================================');
    console.log('DATABASE PERMISSION SYSTEM CHECKER');
    console.log('===========================================\n');

    console.log('Connecting to database...');
    console.log(`Server: ${config.server}:${config.port}`);
    console.log(`Database: ${config.database}`);
    console.log(`User: ${config.user}\n`);

    pool = await sql.connect(config);
    console.log('✓ Database connected successfully\n');

    // 1. Check Permission Categories
    console.log('===========================================');
    console.log('1. PERMISSION CATEGORIES');
    console.log('===========================================');
    const categories = await pool.request().query(`
      SELECT category_key, category_name, is_active,
             (SELECT COUNT(*) FROM PERMISSIONS WHERE category_id = pc.category_id) as permission_count
      FROM PERMISSION_CATEGORIES pc
      ORDER BY display_order
    `);
    console.log(`Total Categories: ${categories.recordset.length}\n`);
    categories.recordset.forEach(cat => {
      console.log(`  ${cat.is_active ? '✓' : '✗'} ${cat.category_key.padEnd(25)} ${cat.category_name.padEnd(30)} (${cat.permission_count} permissions)`);
    });

    // 2. Check Total Permissions
    console.log('\n===========================================');
    console.log('2. PERMISSIONS');
    console.log('===========================================');
    const permCount = await pool.request().query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
             SUM(CASE WHEN is_system = 1 THEN 1 ELSE 0 END) as system_perms
      FROM PERMISSIONS
    `);
    const pStats = permCount.recordset[0];
    console.log(`Total Permissions: ${pStats.total}`);
    console.log(`Active Permissions: ${pStats.active}`);
    console.log(`System Permissions: ${pStats.system_perms}\n`);

    // List all permissions grouped by category
    const perms = await pool.request().query(`
      SELECT p.permission_key, p.permission_name, p.is_active,
             pc.category_key, pc.category_name
      FROM PERMISSIONS p
      LEFT JOIN PERMISSION_CATEGORIES pc ON p.category_id = pc.category_id
      ORDER BY pc.display_order, p.display_order
    `);

    let currentCategory = '';
    perms.recordset.forEach(perm => {
      if (perm.category_key !== currentCategory) {
        currentCategory = perm.category_key;
        console.log(`\n  [${perm.category_name || 'Uncategorized'}]`);
      }
      console.log(`    ${perm.is_active ? '✓' : '✗'} ${perm.permission_key.padEnd(35)} ${perm.permission_name}`);
    });

    // 3. Check Role Templates
    console.log('\n===========================================');
    console.log('3. ROLE TEMPLATES');
    console.log('===========================================');
    const roles = await pool.request().query(`
      SELECT rt.role_name, rt.display_name, rt.hierarchy_level, rt.is_active,
             COUNT(rp.permission_id) as permission_count
      FROM ROLE_TEMPLATES rt
      LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id
      GROUP BY rt.role_name, rt.display_name, rt.hierarchy_level, rt.is_active
      ORDER BY rt.hierarchy_level DESC
    `);
    console.log(`Total Roles: ${roles.recordset.length}\n`);
    roles.recordset.forEach(role => {
      console.log(`  ${role.is_active ? '✓' : '✗'} [${String(role.hierarchy_level).padStart(3)}] ${role.role_name.padEnd(25)} ${role.display_name.padEnd(30)} (${role.permission_count} permissions)`);
    });

    // 4. Detailed Role Permissions
    console.log('\n===========================================');
    console.log('4. ROLE PERMISSIONS BREAKDOWN');
    console.log('===========================================');
    for (const role of roles.recordset) {
      const rolePerms = await pool.request()
        .input('roleName', sql.VarChar, role.role_name)
        .query(`
          SELECT p.permission_key
          FROM ROLE_PERMISSIONS rp
          INNER JOIN ROLE_TEMPLATES rt ON rp.role_template_id = rt.role_template_id
          INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
          WHERE rt.role_name = @roleName
          ORDER BY p.permission_key
        `);

      console.log(`\n  ${role.role_name} (${rolePerms.recordset.length} permissions):`);
      const permKeys = rolePerms.recordset.map(p => p.permission_key);

      // Group by resource type
      const grouped = {};
      permKeys.forEach(key => {
        const resource = key.split('.')[0];
        if (!grouped[resource]) grouped[resource] = [];
        grouped[resource].push(key);
      });

      Object.keys(grouped).sort().forEach(resource => {
        console.log(`    ${resource}: ${grouped[resource].join(', ')}`);
      });
    }

    // 5. Check User Custom Permissions
    console.log('\n===========================================');
    console.log('5. USER CUSTOM PERMISSIONS');
    console.log('===========================================');
    const customPerms = await pool.request().query(`
      SELECT COUNT(DISTINCT user_id) as users_with_custom,
             COUNT(*) as total_custom_perms,
             SUM(CASE WHEN is_granted = 1 THEN 1 ELSE 0 END) as granted,
             SUM(CASE WHEN is_granted = 0 THEN 1 ELSE 0 END) as revoked
      FROM USER_CUSTOM_PERMISSIONS
    `);
    const cpStats = customPerms.recordset[0];
    console.log(`Users with custom permissions: ${cpStats.users_with_custom}`);
    console.log(`Total custom permission entries: ${cpStats.total_custom_perms}`);
    console.log(`  - Granted: ${cpStats.granted}`);
    console.log(`  - Revoked: ${cpStats.revoked}`);

    // 6. Check Permission Audit Log
    console.log('\n===========================================');
    console.log('6. PERMISSION AUDIT LOG');
    console.log('===========================================');
    const auditCount = await pool.request().query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT performed_by) as unique_performers,
             MIN(performed_at) as oldest_entry,
             MAX(performed_at) as newest_entry
      FROM PERMISSION_AUDIT_LOG
    `);
    const auditStats = auditCount.recordset[0];
    console.log(`Total Audit Entries: ${auditStats.total}`);
    console.log(`Unique Performers: ${auditStats.unique_performers}`);
    if (auditStats.total > 0) {
      console.log(`Oldest Entry: ${auditStats.oldest_entry}`);
      console.log(`Newest Entry: ${auditStats.newest_entry}`);
    }

    // Recent audit logs
    const recentAudits = await pool.request().query(`
      SELECT TOP 10
        pal.action_type, pal.target_type, pal.performed_at,
        u.first_name + ' ' + u.last_name as performed_by_name,
        rt.role_name as target_role
      FROM PERMISSION_AUDIT_LOG pal
      LEFT JOIN USER_MASTER u ON pal.performed_by = u.user_id
      LEFT JOIN ROLE_TEMPLATES rt ON pal.target_id = rt.role_template_id AND pal.target_type = 'ROLE'
      ORDER BY pal.performed_at DESC
    `);

    if (recentAudits.recordset.length > 0) {
      console.log('\nRecent 10 Audit Entries:');
      recentAudits.recordset.forEach(audit => {
        const target = audit.target_role || audit.target_type;
        console.log(`  [${audit.performed_at.toISOString().split('T')[0]}] ${audit.action_type.padEnd(15)} ${target.padEnd(20)} by ${audit.performed_by_name || 'Unknown'}`);
      });
    }

    // 7. Database Schema Validation
    console.log('\n===========================================');
    console.log('7. SCHEMA VALIDATION');
    console.log('===========================================');

    const tables = [
      'PERMISSION_CATEGORIES',
      'PERMISSIONS',
      'ROLE_TEMPLATES',
      'ROLE_PERMISSIONS',
      'USER_CUSTOM_PERMISSIONS',
      'PERMISSION_AUDIT_LOG',
      'PERMISSION_CACHE'
    ];

    for (const table of tables) {
      const exists = await pool.request()
        .input('tableName', sql.VarChar, table)
        .query(`
          SELECT COUNT(*) as count
          FROM sys.tables
          WHERE name = @tableName
        `);

      const status = exists.recordset[0].count > 0 ? '✓' : '✗';
      console.log(`  ${status} ${table}`);
    }

    // 8. Critical Issues Check
    console.log('\n===========================================');
    console.log('8. CRITICAL ISSUES CHECK');
    console.log('===========================================');

    let issuesFound = false;

    // Check for roles without permissions
    const rolesWithoutPerms = await pool.request().query(`
      SELECT rt.role_name
      FROM ROLE_TEMPLATES rt
      LEFT JOIN ROLE_PERMISSIONS rp ON rt.role_template_id = rp.role_template_id
      WHERE rt.is_active = 1
      GROUP BY rt.role_name, rt.role_template_id
      HAVING COUNT(rp.permission_id) = 0
    `);

    if (rolesWithoutPerms.recordset.length > 0) {
      issuesFound = true;
      console.log('\n⚠️  ROLES WITHOUT PERMISSIONS:');
      rolesWithoutPerms.recordset.forEach(r => console.log(`    - ${r.role_name}`));
    }

    // Check for orphaned role permissions
    const orphanedPerms = await pool.request().query(`
      SELECT COUNT(*) as count
      FROM ROLE_PERMISSIONS rp
      WHERE NOT EXISTS (SELECT 1 FROM PERMISSIONS p WHERE p.permission_id = rp.permission_id)
         OR NOT EXISTS (SELECT 1 FROM ROLE_TEMPLATES rt WHERE rt.role_template_id = rp.role_template_id)
    `);

    if (orphanedPerms.recordset[0].count > 0) {
      issuesFound = true;
      console.log(`\n⚠️  ORPHANED ROLE PERMISSIONS: ${orphanedPerms.recordset[0].count}`);
    }

    // Check for inactive permissions still assigned
    const inactiveAssigned = await pool.request().query(`
      SELECT COUNT(*) as count
      FROM ROLE_PERMISSIONS rp
      INNER JOIN PERMISSIONS p ON rp.permission_id = p.permission_id
      WHERE p.is_active = 0
    `);

    if (inactiveAssigned.recordset[0].count > 0) {
      issuesFound = true;
      console.log(`\n⚠️  INACTIVE PERMISSIONS STILL ASSIGNED: ${inactiveAssigned.recordset[0].count}`);
    }

    if (!issuesFound) {
      console.log('\n✓ No critical issues found');
    }

    console.log('\n===========================================');
    console.log('CHECK COMPLETE');
    console.log('===========================================\n');

  } catch (error) {
    console.error('\n✗ ERROR:', error.message);
    console.error('\nDetails:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('Database connection closed\n');
    }
  }
}

// Run the checker
checkPermissions().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
