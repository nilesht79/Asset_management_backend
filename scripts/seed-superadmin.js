require('dotenv').config();
const { connectDB } = require('../src/config/database');
const bcrypt = require('bcryptjs');

async function seedSuperAdmin() {
  try {
    console.log('👤 Creating SuperAdmin user...\n');

    const pool = await connectDB();

    const email = 'pranavbhujbal2001@gmail.com';
    const password = 'Admin@123'; // Default password - should be changed after first login
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existingUser = await pool.request()
      .input('email', email)
      .query(`
        SELECT user_id, email, role
        FROM USER_MASTER
        WHERE email = @email
      `);

    if (existingUser.recordset.length > 0) {
      const user = existingUser.recordset[0];
      console.log('⚠️  User already exists:');
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   User ID: ${user.user_id}\n`);

      // Update to superadmin if not already
      if (user.role !== 'superadmin') {
        await pool.request()
          .input('user_id', user.user_id)
          .query(`
            UPDATE USER_MASTER
            SET role = 'superadmin',
                is_active = 1,
                updated_at = GETUTCDATE()
            WHERE user_id = @user_id
          `);
        console.log('✅ Updated existing user to SuperAdmin role\n');
      } else {
        console.log('✅ User is already a SuperAdmin\n');
      }

      console.log('📋 Login credentials:');
      console.log(`   Email: ${email}`);
      console.log(`   Password: (unchanged - use existing password)\n`);
      process.exit(0);
    }

    // Create new superadmin user
    const result = await pool.request()
      .input('email', email)
      .input('password_hash', hashedPassword)
      .query(`
        INSERT INTO USER_MASTER (
          email,
          password_hash,
          role,
          first_name,
          last_name,
          is_active,
          email_verified,
          registration_type,
          user_status,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.user_id, INSERTED.email, INSERTED.role
        VALUES (
          @email,
          @password_hash,
          'superadmin',
          'Pranav',
          'Bhujbal',
          1,
          1,
          'manual',
          'active',
          GETUTCDATE(),
          GETUTCDATE()
        )
      `);

    const newUser = result.recordset[0];

    console.log('✅ SuperAdmin user created successfully!\n');
    console.log('📋 User details:');
    console.log(`   User ID: ${newUser.user_id}`);
    console.log(`   Email: ${newUser.email}`);
    console.log(`   Role: ${newUser.role}`);
    console.log(`   Name: Pranav Bhujbal\n`);

    console.log('🔑 Login credentials:');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log('\n⚠️  Please change the password after first login!\n');

    // Grant all permissions to superadmin
    console.log('🔐 Granting all permissions...');

    // Get all permissions
    const permissions = await pool.request().query(`
      SELECT permission_id FROM PERMISSIONS WHERE is_active = 1
    `);

    if (permissions.recordset.length > 0) {
      for (const perm of permissions.recordset) {
        await pool.request()
          .input('user_id', newUser.user_id)
          .input('permission_id', perm.permission_id)
          .query(`
            IF NOT EXISTS (
              SELECT 1 FROM USER_CUSTOM_PERMISSIONS
              WHERE user_id = @user_id AND permission_id = @permission_id
            )
            BEGIN
              INSERT INTO USER_CUSTOM_PERMISSIONS (
                user_id,
                permission_id,
                is_granted,
                granted_at,
                reason
              )
              VALUES (
                @user_id,
                @permission_id,
                1,
                GETUTCDATE(),
                'SuperAdmin - Full Access'
              )
            END
          `);
      }
      console.log(`   ✅ Granted ${permissions.recordset.length} permission(s)\n`);
    }

    console.log('✅ SuperAdmin setup completed!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating SuperAdmin:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seedSuperAdmin();
