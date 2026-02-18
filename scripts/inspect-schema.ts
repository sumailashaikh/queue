
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('--- Inspecting queue_entries ---');
    const { data: qData, error: qError } = await supabase.from('queue_entries').select('*').limit(1);

    if (qData && qData.length > 0) {
        console.log('queue_entries columns found:', Object.keys(qData[0]));
    } else {
        console.log('queue_entries is empty. Testing column presence...');
        const { error: testError } = await supabase.from('queue_entries').select('appointment_id').limit(1);
        if (testError) console.error('Column appointment_id MISSING in queue_entries:', testError.message);
        else console.log('Column appointment_id is PRESENT in queue_entries.');
    }

    console.log('\n--- Inspecting appointments ---');
    const { data: aData, error: aError } = await supabase.from('appointments').select('*').limit(1);

    if (aData && aData.length > 0) {
        console.log('appointments columns found:', Object.keys(aData[0]));
    } else {
        console.log('appointments is empty. Testing column presence...');
        const { error: testError } = await supabase.from('appointments').select('guest_name, guest_phone').limit(1);
        if (testError) console.error('Guest columns MISSING in appointments:', testError.message);
        else console.log('Guest columns are PRESENT in appointments.');
    }
}

inspect();
