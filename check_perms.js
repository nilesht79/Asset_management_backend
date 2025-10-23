const { connectDB } = require('./src/config/database');

(async () => {
  try {
    const pool = await connectDB();
    const result = await pool.request().query(`
      SELECT TOP 5 * FROM PERMISSIONS
    `);
    console.log(JSON.stringify(result.recordset, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
