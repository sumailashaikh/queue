import { supabase } from './src/config/supabaseClient';

async function checkTasks() {
    console.log("Checking in-progress tasks...");
    const { data, error } = await supabase
        .from('queue_entry_services')
        .select(`
            id,
            assigned_provider_id,
            task_status,
            service_providers(name)
        `)
        .eq('task_status', 'in_progress');

    if (error) {
        console.error('Error fetching tasks:', error);
        return;
    }

    console.log('Orphan tasks in progress:', JSON.stringify(data, null, 2));
}

checkTasks();
