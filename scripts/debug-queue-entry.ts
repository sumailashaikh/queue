
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Use Anon key to simulate client, or Service Role to bypass

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const entryId = '6035821a-c5d4-4bc1-8d2b-493fd2c0da52'; // from user request if it was an entry ID? 
// WAIT: The user said "this is all my queues" and the ID `6035821a...` is a QUEUE ID, not an entry ID.
// The user tried `PUT /api/queues/entries/6035821a.../status`
// BUT `6035821a...` is the QUEUE ID! 
// Ah! The user is passing the Queue ID instead of the Entry ID in the URL.

const check = async () => {
    console.log('Checking ID:', entryId);

    // Check if it's a queue
    const { data: queue } = await supabase.from('queues').select('*').eq('id', entryId).single();
    if (queue) {
        console.log('Use provided ID is a QUEUE:', queue.name);
    } else {
        console.log('Not a queue.');
    }

    // Check if it's an entry
    const { data: entry } = await supabase.from('queue_entries').select('*').eq('id', entryId).single();
    if (entry) {
        console.log('Use provided ID is an ENTRY:', entry);
    } else {
        console.log('Not an entry.');
    }
};

check();
