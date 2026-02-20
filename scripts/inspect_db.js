const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTable() {
    console.log('Inspecting queue_entry_services...');

    // We can't query information_schema directly with anon key usually, 
    // but we can try a select with an intentional error or just check the data structure
    const { data, error } = await supabase
        .from('queue_entry_services')
        .select(`
            id,
            queue_entries (id)
        `)
        .limit(1);

    if (error) {
        console.error('Select with join error:', JSON.stringify(error, null, 2));
    } else {
        console.log('Select with join success:', JSON.stringify(data, null, 2));
    }
}

inspectTable();
