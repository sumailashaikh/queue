
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugData() {
    console.log('--- DEBUGGING QUEUE DATA ---');

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    console.log('Node.js Today (IST):', todayStr);

    // 1. Check entries
    const { data: entries, error: eErr } = await supabase
        .from('queue_entries')
        .select('id, customer_name, status, entry_date, joined_at')
        .order('joined_at', { ascending: false })
        .limit(10);

    if (eErr) {
        console.error('Error fetching entries:', eErr);
    } else {
        console.log('\nLatest 10 Entries:');
        entries.forEach(e => {
            console.log(`- ${e.customer_name} | Status: ${e.status} | entry_date: ${e.entry_date} | joined_at: ${e.joined_at}`);
        });
    }

    // 2. Check current date from Postgres
    const { data: dbDate, error: dErr } = await supabase.rpc('get_current_date_debug');
    // If RPC doesn't exist, we can just select it
    const { data: rawDate } = await supabase.from('queue_entries').select('entry_date').limit(1);

    console.log('\nDB current_date from SQL:');
    const { data: sqlDate, error: sqlErr } = await supabase.from('profiles').select('dummy:now()').limit(1);
    // Actually simpler:
    const { data: nowData } = await supabase.rpc('now'); // if exists

    // Let's just look at the entries we found.
}

debugData();
