
// TEST PASSWORD CHECK API
router.post('/test-password', async (req, res) => {
  try {
    const { employeeId, password } = req.body;

    const bcrypt = require('bcryptjs');

    // CONNECT DB
    const pool = await connectDB();

    // GET USER HASH
    const result = await pool.request()
      .input('employeeId', sql.VarChar, employeeId)
      .query(`
        SELECT employee_id, password_hash
        FROM USER_MASTER
        WHERE employee_id = @employeeId
      `);

    // USER NOT FOUND
    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.recordset[0];

    console.log("Entered Password:", password);
    console.log("Stored Hash:", user.password_hash);

    // PASSWORD MATCH CHECK
    const isMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    return res.json({
      success: true,
      employeeId: user.employee_id,
      enteredPassword: password,
      storedHash: user.password_hash,
      passwordMatched: isMatch
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: 'Password check failed'
    });
  }
});

