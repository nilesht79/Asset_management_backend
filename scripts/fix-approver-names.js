const { connectDB, sql } = require('../src/config/database');

async function fixApproverNames() {
  try {
    const pool = await connectDB();
    console.log('Fixing approver names in ASSET_REQUISITIONS...\n');

    // Get all requisitions with "undefined undefined" in approver names
    const result = await pool.request()
      .query(`
        SELECT
          requisition_id,
          requisition_number,
          dept_head_id,
          dept_head_name,
          it_head_id,
          it_head_name
        FROM ASSET_REQUISITIONS
        WHERE dept_head_name = 'undefined undefined'
           OR it_head_name = 'undefined undefined'
      `);

    if (result.recordset.length === 0) {
      console.log('✓ No requisitions found with undefined names. All good!');
      process.exit(0);
    }

    console.log(`Found ${result.recordset.length} requisition(s) with undefined names:\n`);

    for (const req of result.recordset) {
      console.log(`Processing ${req.requisition_number}...`);

      let updated = false;

      // Fix dept_head_name if undefined
      if (req.dept_head_name === 'undefined undefined' && req.dept_head_id) {
        const deptHeadResult = await pool.request()
          .input('userId', sql.UniqueIdentifier, req.dept_head_id)
          .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @userId');

        if (deptHeadResult.recordset.length > 0) {
          const deptHead = deptHeadResult.recordset[0];
          const fullName = `${deptHead.first_name} ${deptHead.last_name}`;

          await pool.request()
            .input('reqId', sql.UniqueIdentifier, req.requisition_id)
            .input('name', sql.NVarChar(200), fullName)
            .query('UPDATE ASSET_REQUISITIONS SET dept_head_name = @name WHERE requisition_id = @reqId');

          console.log(`  ✓ Updated dept_head_name to: ${fullName}`);
          updated = true;
        } else {
          console.log(`  ⚠️  Department Head user not found`);
        }
      }

      // Fix it_head_name if undefined
      if (req.it_head_name === 'undefined undefined' && req.it_head_id) {
        const itHeadResult = await pool.request()
          .input('userId', sql.UniqueIdentifier, req.it_head_id)
          .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @userId');

        if (itHeadResult.recordset.length > 0) {
          const itHead = itHeadResult.recordset[0];
          const fullName = `${itHead.first_name} ${itHead.last_name}`;

          await pool.request()
            .input('reqId', sql.UniqueIdentifier, req.requisition_id)
            .input('name', sql.NVarChar(200), fullName)
            .query('UPDATE ASSET_REQUISITIONS SET it_head_name = @name WHERE requisition_id = @reqId');

          console.log(`  ✓ Updated it_head_name to: ${fullName}`);
          updated = true;
        } else {
          console.log(`  ⚠️  IT Head user not found`);
        }
      }

      if (!updated) {
        console.log(`  ℹ️  No updates needed or approver not found`);
      }
      console.log('');
    }

    console.log('✅ Approver names fix completed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error fixing approver names:', error);
    process.exit(1);
  }
}

fixApproverNames();
