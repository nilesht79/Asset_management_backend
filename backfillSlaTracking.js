const { connectDB, sql } = require('./src/config/database');
const SlaTrackingModel = require('./src/models/slaTracking');

async function backfillMissingSla() {
    const pool = await connectDB();

    const result = await pool.request().query(`
        SELECT
            t.ticket_id,
            t.ticket_number,
            t.priority,
            t.category,
            t.ticket_type,
            t.channel,
            t.created_by,
            t.created_at,
            t.resolved_at
        FROM TICKETS t
        LEFT JOIN TICKET_SLA_TRACKING s
            ON s.ticket_id = t.ticket_id
        WHERE
            t.status = 'closed'
            AND t.resolved_at IS NOT NULL
            AND s.ticket_id IS NULL
    `);

    console.log(`Found ${result.recordset.length} missing tickets.`);

    for (const ticket of result.recordset) {
        try {

            const ticketContext = {
                priority: ticket.priority,
                category: ticket.category,
                ticket_type: ticket.ticket_type,
                channel: ticket.channel,
                created_by: ticket.created_by
            };

            await SlaTrackingModel.initializeTracking(
                ticket.ticket_id,
                ticketContext
            );

            await SlaTrackingModel.stopTracking(
                ticket.ticket_id,
                null
            );

            console.log(`✔ ${ticket.ticket_number}`);
        }
        catch (err) {
            console.log(`✖ ${ticket.ticket_number}`);
            console.log(err.message);
        }
    }

    console.log("Done");
    process.exit(0);
}

backfillMissingSla().catch(console.error);
