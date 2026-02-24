import { supabase } from './src/config/supabaseClient';

async function checkTasks() {
    console.log("Checking Vishal's tasks...");
    const { data: providers } = await supabase.from('service_providers').select('*').ilike('name', '%vishal%');

    if (providers && providers.length > 0) {
        const { data, error } = await supabase
            .from('queue_entry_services')
            .select(`
                id,
                assigned_provider_id,
                task_status,
                service_providers(name),
                queue_entries(entry_date, status, customer_name, queues(business_id))
            `)
            .eq('assigned_provider_id', providers[0].id)
            .eq('task_status', 'in_progress');

        console.log("Vishal's ghost tasks:", JSON.stringify(data, null, 2));
    }
}
checkTasks();
