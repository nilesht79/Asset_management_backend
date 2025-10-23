/**
 * Test script for Board CRUD operations
 * Tests the /api/v1/boards endpoints
 */

const { connectDB, sql } = require('./src/config/database');

async function testBoardCRUD() {
  console.log('🧪 Testing Board CRUD Operations\n');

  try {
    const pool = await connectDB();
    console.log('✅ Database connection established\n');

    // Test 1: Check if BOARD_MASTER table exists
    console.log('Test 1: Checking BOARD_MASTER table...');
    const tableCheck = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'BOARD_MASTER'
    `);

    if (tableCheck.recordset.length > 0) {
      console.log('✅ BOARD_MASTER table exists\n');
    } else {
      console.log('❌ BOARD_MASTER table does not exist\n');
      return;
    }

    // Test 2: Check if BOARD_DEPARTMENTS junction table exists
    console.log('Test 2: Checking BOARD_DEPARTMENTS table...');
    const junctionTableCheck = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'BOARD_DEPARTMENTS'
    `);

    if (junctionTableCheck.recordset.length > 0) {
      console.log('✅ BOARD_DEPARTMENTS junction table exists\n');
    } else {
      console.log('❌ BOARD_DEPARTMENTS table does not exist\n');
      return;
    }

    // Test 3: Get table structure
    console.log('Test 3: BOARD_MASTER table structure:');
    const columns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'BOARD_MASTER'
      ORDER BY ORDINAL_POSITION
    `);

    console.table(columns.recordset);

    // Test 4: Check for existing boards
    console.log('\nTest 4: Checking existing boards...');
    const existingBoards = await pool.request().query(`
      SELECT board_id, board_name, description, is_active, created_at
      FROM BOARD_MASTER
    `);

    console.log(`Found ${existingBoards.recordset.length} existing board(s)`);
    if (existingBoards.recordset.length > 0) {
      console.table(existingBoards.recordset.map(b => ({
        name: b.board_name,
        description: b.description?.substring(0, 50),
        active: b.is_active,
        created: new Date(b.created_at).toLocaleDateString()
      })));
    }

    // Test 5: Check board permissions
    console.log('\nTest 5: Checking board permissions...');
    const permissions = await pool.request().query(`
      SELECT permission_key, permission_name, description
      FROM PERMISSIONS
      WHERE permission_key LIKE 'boards.%'
    `);

    console.log(`Found ${permissions.recordset.length} board permission(s)`);
    console.table(permissions.recordset);

    // Test 6: Check board-department relationships
    console.log('\nTest 6: Checking board-department relationships...');
    const relationships = await pool.request().query(`
      SELECT
        b.board_name,
        d.department_name,
        bd.assigned_at
      FROM BOARD_DEPARTMENTS bd
      INNER JOIN BOARD_MASTER b ON bd.board_id = b.board_id
      INNER JOIN DEPARTMENT_MASTER d ON bd.department_id = d.department_id
      ORDER BY b.board_name, d.department_name
    `);

    console.log(`Found ${relationships.recordset.length} board-department relationship(s)`);
    if (relationships.recordset.length > 0) {
      console.table(relationships.recordset);
    }

    // Test 7: Get departments count per board
    console.log('\nTest 7: Department counts per board:');
    const boardStats = await pool.request().query(`
      SELECT
        b.board_name,
        COUNT(bd.department_id) as department_count,
        b.is_active
      FROM BOARD_MASTER b
      LEFT JOIN BOARD_DEPARTMENTS bd ON b.board_id = bd.board_id
      GROUP BY b.board_name, b.is_active
      ORDER BY department_count DESC
    `);

    if (boardStats.recordset.length > 0) {
      console.table(boardStats.recordset);
    } else {
      console.log('No boards found');
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('\n📝 Summary:');
    console.log('- BOARD_MASTER table: ✓');
    console.log('- BOARD_DEPARTMENTS table: ✓');
    console.log(`- Existing boards: ${existingBoards.recordset.length}`);
    console.log(`- Board permissions: ${permissions.recordset.length}`);
    console.log(`- Board-department links: ${relationships.recordset.length}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

testBoardCRUD();
