import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSchema() {
    console.log('🚀 Starting Schema Health Check...');

    // 1. Verify table existence
    console.log('\nChecking tables...');
    const tables = ['queue_entry_services', 'appointment_services', 'services'];
    for (const table of tables) {
        const { error } = await supabase.from(table).select('id').limit(1);
        if (error) {
            console.error(`❌ Table "${table}" error:`, error.message);
        } else {
            console.log(`✅ Table "${table}" is accessible.`);
        }
    }

    // 2. Refresh Schema Cache (if possible via RPC or just by wait)
    console.log('\nAttempting to refresh PostgREST cache...');
    // We can't easily run NOTIFY via the anon client unless we have an RPC
    // But sometimes just making a request to the table helps.

    console.log('\nTesting Multi-Join syntax...');
    const { data: testData, error: joinError } = await supabase
        .from('queue_entries')
        .select(`
            id,
            queue_entry_services!entry_id (
                id
            )
        `)
        .limit(1);

    if (joinError) {
        console.error('❌ Join failed:', joinError.message);
        console.log('💡 Suggestion: Please run "NOTIFY pgrst, \'reload schema\';" in your Supabase SQL Editor.');
    } else {
        console.log('✅ Join successful! The relationship is correctly recognized.');
    }
}

fixSchema();
