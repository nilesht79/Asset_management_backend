require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function addVipFlag() {
  try {
    console.log('🔧 Adding VIP flag to USER_MASTER table...\n');

    const pool = await connectDB();

    // Check if column already exists
    const checkColumnResult = await pool.request().query(`
      SELECT COUNT(*) as count
      FROM sys.columns
      WHERE object_id = OBJECT_ID('USER_MASTER') AND name = 'is_vip'
    `);

    if (checkColumnResult.recordset[0].count > 0) {
      console.log('⏭️  Column "is_vip" already exists in USER_MASTER table');
      process.exit(0);
    }

    // Add is_vip column
    await pool.request().query(`
      ALTER TABLE USER_MASTER
      ADD is_vip BIT DEFAULT 0 NOT NULL
    `);

    console.log('✅ Added is_vip column to USER_MASTER table');

    // Add index for better performance when filtering VIP users
    await pool.request().query(`
      CREATE INDEX IDX_USER_MASTER_VIP ON USER_MASTER(is_vip)
      WHERE is_vip = 1
    `);

    console.log('✅ Added index for VIP users');

    console.log('\n📋 VIP Flag Details:');
    console.log('   • Column: is_vip (BIT)');
    console.log('   • Default: 0 (false)');
    console.log('   • NULL: Not allowed');
    console.log('   • Index: Created for VIP users (is_vip = 1)');

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding VIP flag:', error.message);
    process.exit(1);
  }
}

addVipFlag();
