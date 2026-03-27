const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data, error } = await supabase
        .from('queue_entries')
        .select('id, customer_name')
        .limit(1)
        .single();
    
    if (error) {
        console.error('Error fetching entry:', error);
        return;
    }
    
    console.log('Testing with Entry ID:', data.id, 'for', data.customer_name);
    
    // We can't easily call the API with requireAuth here without a token
    // But we can check if the ID is valid in the DB at least.
}

test();
