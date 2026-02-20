const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function findUUID(uuid) {
    console.log(`Global search for UUID: ${uuid}`);

    const tables = ['queue_entry_services', 'queue_entries', 'services', 'appointments', 'queues'];

    for (const table of tables) {
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .eq('id', uuid)
            .maybeSingle();

        if (data) {
            console.log(`FOUND in table [${table}]:`, JSON.stringify(data, null, 2));
        } else if (error) {
            console.error(`Error checking [${table}]:`, error.message);
        } else {
            console.log(`Not found in [${table}]`);
        }
    }
}

const uuid = 'c23b7508-8c9e-4d5a-9de5-805dc5b7d132';
findUUID(uuid);
