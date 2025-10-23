const sql = require('mssql');

const config = {
  user: 'sa',
  password: 'YourStrong@Password123',
  server: 'localhost',
  database: 'asset_management',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  port: 1433
};

const ticketId = '0C06500A-7C42-47E7-BD69-65B4B0F33061';

async function checkTicket() {
  try {
    console.log('🔌 Connecting to database...');
    await sql.connect(config);
    console.log('✅ Connected to database\n');

    // Check the ticket
    const result = await sql.query`
      SELECT
        dt.ticket_id,
        dt.ticket_number,
        dt.requisition_id,
        dt.asset_id,
        dt.status,
        r.requisition_id as joined_req_id,
        r.requisition_number,
        r.status as req_status
      FROM ASSET_DELIVERY_TICKETS dt
      LEFT JOIN ASSET_REQUISITIONS r ON dt.requisition_id = r.requisition_id
      WHERE dt.ticket_id = ${ticketId}
    `;

    console.log('📊 Delivery Ticket Details:');
    console.log('==========================================\n');

    if (result.recordset.length === 0) {
      console.log('❌ Ticket not found!\n');
    } else {
      const ticket = result.recordset[0];
      console.log('Ticket ID:', ticket.ticket_id);
      console.log('Ticket Number:', ticket.ticket_number);
      console.log('Ticket Status:', ticket.status);
      console.log('');
      console.log('Requisition ID (from ticket):', ticket.requisition_id);
      console.log('Requisition ID (from join):', ticket.joined_req_id);
      console.log('Requisition Number:', ticket.requisition_number);
      console.log('Requisition Status:', ticket.req_status);
      console.log('');

      // Check if requisition_id is valid
      if (!ticket.requisition_id) {
        console.log('⚠️  WARNING: requisition_id is NULL in delivery ticket!');
      } else if (!ticket.joined_req_id) {
        console.log('⚠️  WARNING: requisition_id exists but no matching requisition found!');
      } else {
        console.log('✅ Requisition link is valid');
      }
    }

    await sql.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkTicket();
