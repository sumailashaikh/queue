const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUsers() {
    // Try to find a profile with role = 'admin' or 'staff'
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['admin', 'staff'])
        .limit(1);

    if (error) {
        console.error('Error fetching users:', error.message);
        return;
    }

    if (profiles && profiles.length > 0) {
        console.log('Found profile:', JSON.stringify(profiles[0], null, 2));
    } else {
        console.log('No admin/staff profiles found.');
    }
}

checkUsers();
