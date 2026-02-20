import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    console.log('🔍 Auditing Junction Table Data...');

    // 1. Check if ANY rows exist in queue_entry_services
    const { data: junctionRows, error: junctionError } = await supabase
        .from('queue_entry_services')
        .select('*, queue_entries(customer_name)')
        .limit(10);

    if (junctionError) {
        console.error('❌ Error fetching junction table:', junctionError.message);
        if (junctionError.message.includes('column "queue_entry_id" does not exist')) {
            console.log('💡 REASON: The column "queue_entry_id" is missing. Migration 21 might not have been applied fully.');
        }
    } else {
        console.log(`✅ Table "queue_entry_services" is accessible. Found ${junctionRows?.length || 0} recent rows.`);
        junctionRows?.forEach(row => {
            console.log(`   - Entry: ${(row as any).queue_entries?.customer_name}, Service ID: ${row.service_id}, Price: ${row.price}`);
        });
    }

    // 2. Check total counts
    const { count: entryCount } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true });
    const { count: jCount } = await supabase.from('queue_entry_services').select('*', { count: 'exact', head: true });

    console.log(`\nStats:`);
    console.log(`- Total Queue Entries: ${entryCount}`);
    console.log(`- Total Junction Rows: ${jCount}`);

    if (entryCount! > 0 && jCount === 0) {
        console.log('⚠️ WARNING: You have entries but NO junction services. Insertions are failing.');
    }
}

checkData();
