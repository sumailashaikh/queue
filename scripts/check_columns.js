const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
    console.log('Checking appointments table...');
    const { data, error } = await supabase
        .from('appointments')
        .select('id, checked_in_at')
        .limit(1);

    if (error) {
        console.error('Column check failed:', JSON.stringify(error, null, 2));
        if (error.message.includes('checked_in_at')) {
            console.log('\nCONFIRMED: Column "checked_in_at" is MISSING in appointments table.');
        }
    } else {
        console.log('Column "checked_in_at" EXISTS.');
    }

    console.log('\nChecking queue_entries table...');
    const { data: qData, error: qError } = await supabase
        .from('queue_entries')
        .select('id, entry_source')
        .limit(1);

    if (qError) {
        console.error('Column check failed:', JSON.stringify(qError, null, 2));
    } else {
        console.log('Column "entry_source" EXISTS.');
    }
}

checkColumns();
