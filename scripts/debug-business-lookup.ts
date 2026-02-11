
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

console.log('URL:', supabaseUrl);
console.log('Key Length:', supabaseKey.length);

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const userId = "20a7f7a0-aab5-49bb-bb7d-beaea59ba06a";
    console.log('Checking business for User:', userId);

    // 1. Check with ANON key (mimicking public access / RLS)
    console.log('\n--- Query with ANON Key ---');
    const { data: anonData, error: anonError } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', userId);

    console.log('Data:', anonData);
    console.log('Error:', anonError);

    // 2. Check if the table is empty or has data generally
    console.log('\n--- Check All Businesses (Limit 5) ---');
    const { data: allData, error: allError } = await supabase
        .from('businesses')
        .select('*')
        .limit(5);
    console.log('All Data:', allData);
    console.log('All Error:', allError);

}

check();
