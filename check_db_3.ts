import { supabase } from './src/config/supabaseClient';

async function checkColumns() {
    const { data: cols, error } = await supabase.rpc('get_column_names', { table_name_input: 'appointment_services' });
    
    // If RPC doesn't exist, we'll try a different trick: insert an empty object and catch the error if it lists columns? No.
    // Let's just try to select a known column and see if it fails.
    
    const { error: error1 } = await supabase.from('appointment_services').select('assigned_provider_id').limit(1);
    console.log('Has assigned_provider_id:', !error1);

    const { error: error2 } = await supabase.from('appointment_services').select('provider_id').limit(1);
    console.log('Has provider_id:', !error2);
    
    const { error: error3 } = await supabase.from('appointment_services').select('assigned_staff_id').limit(1);
    console.log('Has assigned_staff_id:', !error3);
}

checkColumns();
