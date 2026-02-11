
import { supabase } from '../src/config/supabaseClient';

async function testConnection() {
    console.log('Testing Supabase connection...');
    // Query the 'businesses' table which we know exists now
    const { data, error } = await supabase.from('businesses').select('*').limit(1);

    if (error) {
        console.error('❌ Connection Failed:', error.message);
    } else {
        console.log('✅ Connection Successful! Businesses Table Found.');
        console.log('Data (should be empty array if new):', data);
    }
}

testConnection();
