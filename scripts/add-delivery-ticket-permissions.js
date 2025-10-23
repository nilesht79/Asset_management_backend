/**
 * Script to add delivery-tickets permissions to the database
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectDB, sql } = require('../src/config/database');

async function addDeliveryTicketPermissions() {
  let pool;

  try {
    pool = await connectDB();
    console.log('Connected to database');

    // First, get or create the 'delivery_tickets' permission category
    let categoryResult = await pool.request().query(`
      SELECT category_id
      FROM PERMISSION_CATEGORIES
      WHERE category_key = 'delivery_tickets'
    `);

    let categoryId;
    if (categoryResult.recordset.length === 0) {
      // Create the category
      const insertCategoryResult = await pool.request()
        .input('category_key', sql.VarChar, 'delivery_tickets')
        .input('category_name', sql.NVarChar, 'Delivery Tickets')
        .input('description', sql.Text, 'Permissions related to delivery ticket management')
        .input('display_order', sql.Int, 60)
        .input('is_active', sql.Bit, 1)
        .query(`
          INSERT INTO PERMISSION_CATEGORIES (
            category_key, category_name, description, display_order, is_active, created_at
          )
          OUTPUT INSERTED.category_id
          VALUES (
            @category_key, @category_name, @description, @display_order, @is_active, GETUTCDATE()
          )
        `);

      categoryId = insertCategoryResult.recordset[0].category_id;
      console.log('Created delivery_tickets category:', categoryId);
    } else {
      categoryId = categoryResult.recordset[0].category_id;
      console.log('Found existing delivery_tickets category:', categoryId);
    }

    // Define delivery-ticket permissions to add
    const permissions = [
      {
        key: 'delivery-tickets.create',
        name: 'Create Delivery Tickets',
        description: 'Create new delivery tickets',
        resourceType: 'delivery-tickets',
        actionType: 'create',
        displayOrder: 1
      },
      {
        key: 'delivery-tickets.read',
        name: 'View Delivery Tickets',
        description: 'View delivery ticket information',
        resourceType: 'delivery-tickets',
        actionType: 'read',
        displayOrder: 2
      },
      {
        key: 'delivery-tickets.update',
        name: 'Update Delivery Tickets',
        description: 'Update delivery ticket details and status',
        resourceType: 'delivery-tickets',
        actionType: 'update',
        displayOrder: 3
      },
      {
        key: 'delivery-tickets.delete',
        name: 'Delete Delivery Tickets',
        description: 'Delete delivery tickets',
        resourceType: 'delivery-tickets',
        actionType: 'delete',
        displayOrder: 4
      }
    ];

    // Add each permission if it doesn't exist
    for (const perm of permissions) {
      const existsResult = await pool.request()
        .input('permission_key', sql.VarChar, perm.key)
        .query(`
          SELECT permission_id FROM PERMISSIONS WHERE permission_key = @permission_key
        `);

      if (existsResult.recordset.length === 0) {
        await pool.request()
          .input('permission_key', sql.VarChar, perm.key)
          .input('permission_name', sql.NVarChar, perm.name)
          .input('description', sql.Text, perm.description)
          .input('resource_type', sql.VarChar, perm.resourceType)
          .input('action_type', sql.VarChar, perm.actionType)
          .input('category_id', sql.UniqueIdentifier, categoryId)
          .input('is_system', sql.Bit, 1)
          .input('is_active', sql.Bit, 1)
          .input('display_order', sql.Int, perm.displayOrder)
          .query(`
            INSERT INTO PERMISSIONS (
              permission_key, permission_name, description, resource_type, action_type,
              category_id, is_system, is_active, display_order, created_at
            )
            VALUES (
              @permission_key, @permission_name, @description, @resource_type, @action_type,
              @category_id, @is_system, @is_active, @display_order, GETUTCDATE()
            )
          `);
        console.log(`✓ Added permission: ${perm.key}`);
      } else {
        console.log(`- Permission already exists: ${perm.key}`);
      }
    }

    // Now assign these permissions to roles
    const rolePermissions = {
      'superadmin': ['delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete'],
      'admin': ['delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete'],
      'it_head': ['delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete'],
      'coordinator': ['delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete'],
      'engineer': ['delivery-tickets.read', 'delivery-tickets.update']
    };

    console.log('\nAssigning permissions to roles...');

    for (const [roleName, permKeys] of Object.entries(rolePermissions)) {
      // Get role template ID
      const roleResult = await pool.request()
        .input('role_name', sql.VarChar, roleName)
        .query(`SELECT role_template_id FROM ROLE_TEMPLATES WHERE role_name = @role_name`);

      if (roleResult.recordset.length === 0) {
        console.log(`! Role not found: ${roleName}`);
        continue;
      }

      const roleId = roleResult.recordset[0].role_template_id;

      for (const permKey of permKeys) {
        // Get permission ID
        const permResult = await pool.request()
          .input('permission_key', sql.VarChar, permKey)
          .query(`SELECT permission_id FROM PERMISSIONS WHERE permission_key = @permission_key`);

        if (permResult.recordset.length === 0) {
          console.log(`! Permission not found: ${permKey}`);
          continue;
        }

        const permissionId = permResult.recordset[0].permission_id;

        // Check if assignment already exists
        const assignmentExists = await pool.request()
          .input('role_template_id', sql.UniqueIdentifier, roleId)
          .input('permission_id', sql.UniqueIdentifier, permissionId)
          .query(`
            SELECT 1 FROM ROLE_PERMISSIONS
            WHERE role_template_id = @role_template_id AND permission_id = @permission_id
          `);

        if (assignmentExists.recordset.length === 0) {
          await pool.request()
            .input('role_template_id', sql.UniqueIdentifier, roleId)
            .input('permission_id', sql.UniqueIdentifier, permissionId)
            .query(`
              INSERT INTO ROLE_PERMISSIONS (role_template_id, permission_id, granted_at)
              VALUES (@role_template_id, @permission_id, GETUTCDATE())
            `);
          console.log(`✓ Assigned ${permKey} to ${roleName}`);
        } else {
          console.log(`- ${roleName} already has ${permKey}`);
        }
      }
    }

    console.log('\n✅ Delivery ticket permissions added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error adding delivery ticket permissions:', error);
    process.exit(1);
  }
}

addDeliveryTicketPermissions();
