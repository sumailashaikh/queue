
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
    console.log('--- CHECKING BUSINESSES ---');
    console.log('URL:', process.env.SUPABASE_URL);
    const { data: b, error } = await supabase.from('businesses').select('*');
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('BUSINESSES count:', b.length);
        console.log(JSON.stringify(b, null, 2));
    }
}

check();
