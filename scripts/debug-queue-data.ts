
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Need this to bypass RLS for debugging data

const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseAdminKey);

async function debug() {
    console.log('--- DEBUGGING QUEUE UPDATE ERROR ---');

    // 1. Get some business owners
    const { data: businesses, error: bErr } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_id, name')
        .limit(5);

    if (bErr) {
        console.error('Error fetching businesses:', bErr);
        return;
    }

    console.log(`Found ${businesses?.length} businesses.`);

    for (const biz of businesses || []) {
        console.log(`\nBusiness: ${biz.name} (ID: ${biz.id}, Owner: ${biz.owner_id})`);

        // 2. Get queues for this business
        const { data: queues, error: qErr } = await supabaseAdmin
            .from('queues')
            .select('id, name')
            .eq('business_id', biz.id);

        if (qErr) {
            console.error('Error fetching queues:', qErr);
            continue;
        }

        console.log(`  Queues: ${queues?.length}`);

        for (const queue of queues || []) {
            console.log(`    Queue: ${queue.name} (ID: ${queue.id})`);

            // 3. Get entries for this queue
            const { data: entries, error: eErr } = await supabaseAdmin
                .from('queue_entries')
                .select('id, customer_name, status')
                .eq('queue_id', queue.id)
                .limit(3);

            if (eErr) {
                console.error('Error fetching entries:', eErr);
                continue;
            }

            console.log(`      Entries: ${entries?.length}`);
            for (const entry of entries || []) {
                console.log(`        Entry: ${entry.customer_name} (ID: ${entry.id}, Status: ${entry.status})`);
            }
        }
    }

    console.log('\n--- END DEBUG ---');
}

debug();
