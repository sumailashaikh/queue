import { supabase } from './src/config/supabaseClient';

async function checkColumns() {
    const { data: apptServices, error: asError } = await supabase.from('appointment_services').select('*').limit(1);
    if (asError) {
        console.error('Error fetching appointment_services:', asError);
    } else {
        console.log('Appointment Service columns:', Object.keys(apptServices[0] || {}));
    }
}

checkColumns();
