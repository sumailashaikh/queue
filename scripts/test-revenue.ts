
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '');

async function debug() {
    console.log('--- SYSTEM REVENUE DEBUG ---');

    // 1. Get Queues with Service info
    const { data: queues, error: qError } = await supabase
        .from('queues')
        .select(`
            id, 
            name, 
            service_id, 
            services (id, name, price)
        `);

    if (qError) console.error('Queue Error:', qError);
    console.log('QUEUES CONFIG:', JSON.stringify(queues, null, 2));

    // 2. Get active entries for today
    const { data: entries, error: eError } = await supabase
        .from('queue_entries')
        .select('id, queue_id, status');

    if (eError) console.error('Entry Error:', eError);
    console.log('TOTAL ENTRIES IN DB:', entries?.length || 0);

    // 3. Calculate expected revenue for each queue
    queues?.forEach(q => {
        const qEntries = entries?.filter(e => e.queue_id === q.id && (e.status === 'waiting' || e.status === 'serving'));
        const price = (q as any).services?.price || 0;
        const revenue = (qEntries?.length || 0) * price;
        console.log(`Queue: ${q.name} | Price: ${price} | Active People: ${qEntries?.length} | Expected Rev: ${revenue}`);
    });
}

debug().catch(console.error);
