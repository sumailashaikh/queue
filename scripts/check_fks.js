const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkFKs() {
    // Try to query the table status or just check if we can join
    const { data, error } = await supabase
        .from('queue_entries')
        .select(`
            id,
            queue_entry_services (id)
        `)
        .limit(1);

    if (error) {
        console.error('Relationship Error:', JSON.stringify(error, null, 2));
    } else {
        console.log('Relationship Success!');
    }
}

checkFKs();
