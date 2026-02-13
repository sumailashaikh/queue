
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function finalCheck() {
    console.log('--- FINAL DB CHECK ---');

    // Check if the business owner profile exists
    const ownerId = '20a7f7a0-aab5-49bb-bb7d-beaea59ba06a';
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', ownerId).single();
    console.log('Owner Profile:', profile);

    // Check for entries in the queue we found
    const queueId = '623fb131-da3d-4ab8-b7fc-bff15deb43a0';

    // Try to see if we can see ANY entries by selecting with a guess of what might be allowed
    const { data: entries, error } = await supabase.from('queue_entries').select('*').eq('queue_id', queueId);
    console.log('Entries for Haircut Queue:', entries);
    if (error) console.error('Error fetching entries:', error);

    // If entries are empty, it's either RLS or truly empty.
    // Let's try to COUNT them.
    const { count } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true });
    console.log('Total entries count in DB (across all queues):', count);
}

finalCheck();
