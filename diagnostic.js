require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnostics() {
    try {
        // 1. Check queue_entries wait time logic
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        console.log("Today is:", todayStr);

        const { data: qData, error: qErr } = await supabase
            .from('queues')
            .select('id, name')
            .limit(1);

        if (qData && qData.length > 0) {
            const queue_id = qData[0].id;
            console.log("Found queue:", qData[0].name, queue_id);

            const { data: entriesAhead } = await supabase
                .from('queue_entries')
                .select('id, status, total_duration_minutes, customer_name, entry_date')
                .eq('queue_id', queue_id)
                .eq('entry_date', todayStr)
                .in('status', ['waiting', 'serving']);

            console.log("Entries ahead:", entriesAhead);

            let currentWaitTime = 0;
            entriesAhead?.forEach((e) => {
                currentWaitTime += (e.total_duration_minutes || 10);
            });
            console.log("Calculated currentWaitTime:", currentWaitTime);

            // Let's test checking limits
            const nowMins = (new Date().getHours() * 60) + new Date().getMinutes();
            const estEnd = nowMins + currentWaitTime + 30;
            console.log(`nowMins: ${nowMins}, estEnd: ${estEnd}, closeMins (21:00): ${21 * 60 - 10}`);
        }

        // 2. Check schema for queue_entry_services nullable service_id
        console.log("\nTesting insert of null service_id...");
        // Find an existing queue_entry just for foreign key test
        const { data: existingEntry } = await supabase.from('queue_entries').select('id').limit(1);

        if (existingEntry && existingEntry.length > 0) {
            const testId = existingEntry[0].id;
            const { data: insertRes, error: insertErr } = await supabase.from('queue_entry_services').insert([{
                queue_entry_id: testId,
                service_id: null,
                price: 0,
                duration_minutes: 5
            }]).select();

            if (insertErr) {
                console.error("Failed to insert null service_id:", insertErr.message);
            } else {
                console.log("Successfully inserted null service_id. Returning:", insertRes);
                // Clean up
                await supabase.from('queue_entry_services').delete().eq('id', insertRes[0].id);
            }
        }
    } catch (err) {
        console.error(err);
    }
}

runDiagnostics();
