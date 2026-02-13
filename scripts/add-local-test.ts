
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function addLocalTestEntry() {
    console.log('--- ADDING LOCAL TEST ENTRY ---');

    const queueId = '623fb131-da3d-4ab8-b7fc-bff15deb43a0'; // Haircut Queue
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    console.log(`Target Queue: ${queueId}`);
    console.log(`Target Date: ${todayStr}`);

    const { data, error } = await supabase
        .from('queue_entries')
        .insert([
            {
                queue_id: queueId,
                customer_name: 'Local Test User',
                phone: '+910000000000',
                service_name: 'Test Service',
                status: 'waiting',
                position: 1,
                ticket_number: 'LOCAL-001',
                entry_date: todayStr
            }
        ])
        .select();

    if (error) {
        console.error('Error adding entry:', error);
    } else {
        console.log('SUCCESS! Added entry:', data[0]);
        console.log('\nNow refresh your local dashboard at http://localhost:3000/dashboard/queue');
    }
}

addLocalTestEntry();
