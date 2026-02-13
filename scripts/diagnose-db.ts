
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log('--- DATABASE DIAGNOSIS ---');
    console.log('URL:', supabaseUrl);

    // 1. Check Businesses
    const { data: businesses, error: bErr } = await supabase.from('businesses').select('*');
    console.log('\n--- Businesses ---');
    if (bErr) console.error('Error:', bErr);
    else console.log(businesses);

    // 2. Check Queues
    const { data: queues, error: qErr } = await supabase.from('queues').select('*');
    console.log('\n--- Queues ---');
    if (qErr) console.error('Error:', qErr);
    else console.log(queues);

    // 3. Check Queue Entries
    const { data: entries, error: eErr } = await supabase.from('queue_entries').select('*');
    console.log('\n--- Queue Entries ---');
    if (eErr) console.error('Error:', eErr);
    else console.log(entries);

    // 4. Check Profiles (to see who exists)
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
    console.log('\n--- Profiles ---');
    if (pErr) console.error('Error:', pErr);
    else console.log(profiles);
}

diagnose();
