const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkGuestColumns() {
    console.log('Checking appointments table for guest columns...');
    const { data, error } = await supabase
        .from('appointments')
        .select('id, guest_name, guest_phone')
        .limit(1);

    if (error) {
        console.error('Guest column check failed:', JSON.stringify(error, null, 2));
    } else {
        console.log('Guest columns exist.');
    }
}

checkGuestColumns();
