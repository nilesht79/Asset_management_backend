const { connectDB, sql } = require("./src/config/database");
const SlaTrackingModel = require("./src/models/slaTracking");

async function backfillMissingSla() {
    const pool = await connectDB();

    const result = await pool.request().query(`
        SELECT
            t.ticket_id,
            t.ticket_number,
            t.priority,
            t.ticket_type,
            t.ticket_channel,
            t.created_by_user_id,
            t.created_at,
            t.resolved_at
        FROM TICKETS t
        LEFT JOIN TICKET_SLA_TRACKING s
            ON s.ticket_id = t.ticket_id
        WHERE
            t.status = 'closed'
            AND t.resolved_at IS NOT NULL
            AND s.ticket_id IS NULL
        ORDER BY t.created_at
    `);

    console.log(`Found ${result.recordset.length} missing tickets`);

    for (const ticket of result.recordset) {

        try {

            // Get linked assets
            const assetResult = await pool.request()
                .input("ticketId", sql.UniqueIdentifier, ticket.ticket_id)
                .query(`
                    SELECT asset_id
                    FROM TICKET_ASSETS
                    WHERE ticket_id = @ticketId
                `);

            const assetIds = assetResult.recordset.map(r => r.asset_id);

            const ticketContext = {
                ticket_id: ticket.ticket_id,
                ticket_type: ticket.ticket_type,
                ticket_channel: ticket.ticket_channel,
                priority: ticket.priority,
                user_id: ticket.created_by_user_id,
                asset_ids: assetIds
            };

            console.log(`Processing ${ticket.ticket_number}...`);

            await SlaTrackingModel.initializeTracking(
                ticket.ticket_id,
                ticketContext
            );

            await SlaTrackingModel.stopTracking(
                ticket.ticket_id,
                null
            );

            console.log(`SUCCESS : ${ticket.ticket_number}`);

        } catch (err) {

            console.log(`FAILED : ${ticket.ticket_number}`);
            console.log(err.message);

        }
    }

    console.log("Completed");

    process.exit(0);
}

backfillMissingSla().catch(err => {
    console.error(err);
    process.exit(1);
});
