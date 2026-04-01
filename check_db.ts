import { supabase } from './src/config/supabaseClient';

async function checkColumns() {
    const { data, error } = await supabase.from('appointments').select('*').limit(1);
    if (error) {
        console.error('Error fetching appointment:', error);
    } else {
        console.log('Appointment columns:', Object.keys(data[0] || {}));
    }
    
    const { data: services, error: sError } = await supabase.from('queue_entry_services').select('*').limit(1);
        if (sError) {
        console.error('Error fetching queue_entry_service:', sError);
    } else {
        console.log('Queue Entry Service columns:', Object.keys(services[0] || {}));
    }
}

checkColumns();
