import { supabase } from './src/config/supabaseClient';

async function checkColumns() {
    const { data, error } = await supabase.from('appointments').select('*').limit(1);
    if (error) {
        console.error('Error fetching appointment:', error);
        return;
    }
    const sample = data[0] || {};
    console.log('--- ALL APPOINTMENT COLUMNS ---');
    Object.keys(sample).forEach(k => console.log(k));
    console.log('-------------------------------');
}

checkColumns();
