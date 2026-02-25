
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking businesses table columns...');
    const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching from businesses:', error.message);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns found:', Object.keys(data[0]));
        if (Object.keys(data[0]).includes('checkin_creates_queue_entry')) {
            console.log('✅ checkin_creates_queue_entry EXISTS');
        } else {
            console.log('❌ checkin_creates_queue_entry MISSING');
        }
    } else {
        console.log('No data in businesses table to check columns.');
    }

    console.log('\nChecking appointments table columns...');
    const { data: apptData, error: apptError } = await supabase
        .from('appointments')
        .select('*')
        .limit(1);

    if (apptError) {
        console.error('Error fetching from appointments:', apptError.message);
        return;
    }

    if (apptData && apptData.length > 0) {
        console.log('Columns found:', Object.keys(apptData[0]));
        const required = ['checked_in_at', 'started_at', 'completed_at', 'payment_status', 'appointment_token'];
        required.forEach(col => {
            if (Object.keys(apptData[0]).includes(col)) {
                console.log(`✅ ${col} EXISTS`);
            } else {
                console.log(`❌ ${col} MISSING`);
            }
        });
    }
}

checkSchema();
