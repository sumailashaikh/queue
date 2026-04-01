import { supabase } from './src/config/supabaseClient';

async function checkColumns() {
    const { data, error } = await supabase.from('service_providers').select('*').limit(1);
    if (error) {
        console.error('Error fetching service_providers:', error);
    } else {
        console.log('Service Provider columns:', Object.keys(data[0] || {}));
    }
}

checkColumns();
