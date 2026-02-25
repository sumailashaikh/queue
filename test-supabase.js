
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('Testing Supabase Connection...');
console.log('URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log('1. Testing DB Select...');
    const start = Date.now();
    try {
        const { data, error } = await supabase.from('profiles').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log('DB SUCCESS:', data, `(${Date.now() - start}ms)`);
    } catch (err) {
        console.error('DB FAIL:', err.message, `(${Date.now() - start}ms)`);
    }

    console.log('2. Testing Auth getUser (dummy token)...');
    const start2 = Date.now();
    try {
        const { data, error } = await supabase.auth.getUser('invalid-token');
        // This should return an error but NOT hang
        console.log('AUTH RESPONSE (expected error):', error?.message || 'No error?', `(${Date.now() - start2}ms)`);
    } catch (err) {
        console.error('AUTH FAIL:', err.message, `(${Date.now() - start2}ms)`);
    }
}

test();
