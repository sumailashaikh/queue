const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkQESColumns() {
    console.log('Checking queue_entry_services table...');
    const { data, error } = await supabase
        .from('queue_entry_services')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns found:', Object.keys(data[0]).join(', '));
    } else {
        console.log('Table exists but has no data. Checking schema via query if possible...');
        // Fallback or just assume they are missing if we can't see them
    }
}

checkQESColumns();
