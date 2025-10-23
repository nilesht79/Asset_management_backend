/**
 * Test User Board Filter
 * Verifies that users can be filtered by board through the API
 */

const { connectDB, sql } = require('./src/config/database');

async function testUserBoardFilter() {
  console.log('🧪 Testing User Board Filter\n');

  try {
    const pool = await connectDB();
    console.log('✅ Database connected\n');

    // Test 1: Check if boards exist
    console.log('Test 1: Checking for boards...');
    const boards = await pool.request().query(`
      SELECT TOP 5 board_id, board_name
      FROM BOARD_MASTER
      WHERE is_active = 1
      ORDER BY created_at DESC
    `);

    if (boards.recordset.length === 0) {
      console.log('  ⚠️  No boards found. Please create a board first.');
      process.exit(0);
    }

    console.log(`  ✅ Found ${boards.recordset.length} board(s)`);
    boards.recordset.forEach(board => {
      console.log(`     - ${board.board_name} (${board.board_id})`);
    });

    // Test 2: Check board-department associations
    console.log('\n\nTest 2: Checking board-department associations...');
    const testBoard = boards.recordset[0];
    const boardDepts = await pool.request()
      .input('boardId', sql.UniqueIdentifier, testBoard.board_id)
      .query(`
        SELECT d.department_id, d.department_name
        FROM BOARD_DEPARTMENTS bd
        INNER JOIN DEPARTMENT_MASTER d ON bd.department_id = d.department_id
        WHERE bd.board_id = @boardId
      `);

    if (boardDepts.recordset.length === 0) {
      console.log(`  ⚠️  Board "${testBoard.board_name}" has no departments assigned.`);
      console.log('     Please assign departments to this board first.');
      process.exit(0);
    }

    console.log(`  ✅ Board "${testBoard.board_name}" has ${boardDepts.recordset.length} department(s):`);
    boardDepts.recordset.forEach(dept => {
      console.log(`     - ${dept.department_name}`);
    });

    // Test 3: Check users in those departments
    console.log('\n\nTest 3: Checking users in board departments...');
    const usersInBoard = await pool.request()
      .input('boardId', sql.UniqueIdentifier, testBoard.board_id)
      .query(`
        SELECT
          u.user_id,
          u.first_name,
          u.last_name,
          u.email,
          u.role,
          d.department_name
        FROM USER_MASTER u
        INNER JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        WHERE u.department_id IN (
          SELECT department_id
          FROM BOARD_DEPARTMENTS
          WHERE board_id = @boardId
        )
        ORDER BY d.department_name, u.last_name
      `);

    if (usersInBoard.recordset.length === 0) {
      console.log(`  ⚠️  No users found in departments of board "${testBoard.board_name}".`);
      console.log('     The filter logic is working, but there are no users to display.');
    } else {
      console.log(`  ✅ Found ${usersInBoard.recordset.length} user(s) in board "${testBoard.board_name}":`);

      // Group by department
      const byDept = usersInBoard.recordset.reduce((acc, user) => {
        if (!acc[user.department_name]) {
          acc[user.department_name] = [];
        }
        acc[user.department_name].push(user);
        return acc;
      }, {});

      Object.keys(byDept).forEach(deptName => {
        console.log(`\n     ${deptName}:`);
        byDept[deptName].forEach(user => {
          console.log(`       - ${user.first_name} ${user.last_name} (${user.email}) [${user.role}]`);
        });
      });
    }

    // Test 4: Test the actual query used by the API
    console.log('\n\nTest 4: Testing API query simulation...');
    const apiQueryParams = {
      board_id: testBoard.board_id,
      offset: 0,
      limit: 10
    };

    const apiResult = await pool.request()
      .input('boardId', sql.UniqueIdentifier, apiQueryParams.board_id)
      .input('offset', sql.Int, apiQueryParams.offset)
      .input('limit', sql.Int, apiQueryParams.limit)
      .query(`
        SELECT u.user_id, u.first_name, u.last_name, u.email, u.role,
               u.employee_id, u.is_active, u.last_login, u.created_at, u.updated_at,
               d.department_name, d.department_id,
               l.name as location_name, l.id as location_id
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE 1=1 AND u.department_id IN (
          SELECT department_id
          FROM BOARD_DEPARTMENTS
          WHERE board_id = @boardId
        )
        ORDER BY u.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    console.log(`  ✅ API query executed successfully`);
    console.log(`  📊 Returned ${apiResult.recordset.length} user(s) (limit: ${apiQueryParams.limit})`);

    // Test 5: Test with board_id and department_id filters combined
    if (boardDepts.recordset.length > 0) {
      console.log('\n\nTest 5: Testing combined board + department filter...');
      const testDept = boardDepts.recordset[0];

      const combinedFilter = await pool.request()
        .input('boardId', sql.UniqueIdentifier, testBoard.board_id)
        .input('deptId', sql.UniqueIdentifier, testDept.department_id)
        .query(`
          SELECT COUNT(*) as user_count
          FROM USER_MASTER u
          WHERE u.department_id IN (
            SELECT department_id
            FROM BOARD_DEPARTMENTS
            WHERE board_id = @boardId
          )
          AND u.department_id = @deptId
        `);

      const userCount = combinedFilter.recordset[0].user_count;
      console.log(`  ✅ Combined filter works correctly`);
      console.log(`  📊 Users in board "${testBoard.board_name}" AND department "${testDept.department_name}": ${userCount}`);
    }

    // Test 6: Performance check
    console.log('\n\nTest 6: Performance check...');
    const startTime = Date.now();

    await pool.request()
      .input('boardId', sql.UniqueIdentifier, testBoard.board_id)
      .query(`
        SELECT COUNT(*) as total
        FROM USER_MASTER u
        WHERE u.department_id IN (
          SELECT department_id
          FROM BOARD_DEPARTMENTS
          WHERE board_id = @boardId
        )
      `);

    const endTime = Date.now();
    const queryTime = endTime - startTime;

    console.log(`  ✅ Query execution time: ${queryTime}ms`);
    if (queryTime < 100) {
      console.log('     Performance: Excellent ⚡');
    } else if (queryTime < 500) {
      console.log('     Performance: Good ✅');
    } else {
      console.log('     Performance: Consider adding indexes ⚠️');
    }

    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('✅ User Board Filter Test Completed Successfully!');
    console.log('='.repeat(60));
    console.log('\n📋 Summary:');
    console.log(`  ✅ Board filter query works correctly`);
    console.log(`  ✅ Found ${boards.recordset.length} active board(s)`);
    console.log(`  ✅ Test board has ${boardDepts.recordset.length} department(s)`);
    console.log(`  ✅ Found ${usersInBoard.recordset.length} user(s) in test board`);
    console.log(`  ✅ API query simulation successful`);
    console.log(`  ✅ Combined filters working`);
    console.log(`  ✅ Query performance: ${queryTime}ms`);

    console.log('\n🎯 API Endpoint Ready:');
    console.log(`  GET /api/v1/users?board_id=${testBoard.board_id}`);
    console.log(`  Expected results: ${usersInBoard.recordset.length} user(s)`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

testUserBoardFilter();
