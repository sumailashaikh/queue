const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTask(taskId) {
    console.log(`Verifying hotfix with corrected query for task: ${taskId}`);

    // Updated query matching the fix in queueController.ts
    const { data: task, error: taskError } = await supabase
        .from('queue_entry_services')
        .select(`
            *,
            queue_entries!inner (
                id, 
                entry_date, 
                status, 
                customer_name, 
                phone, 
                user_id,
                queues!inner (business_id)
            ),
            services!service_id (name),
            service_providers!assigned_provider_id (id, name)
        `)
        .eq('id', taskId)
        .single();

    if (taskError) {
        console.error('Error fetching task with corrected query:', JSON.stringify(taskError, null, 2));
    } else {
        console.log('SUCCESS! Task found with corrected query:', JSON.stringify(task, null, 2));
        console.log('Business ID found:', task.queue_entries.queues.business_id);
    }
}

const taskId = 'c23b7508-8c9e-4d5a-9de5-805dc5b7d132';
checkTask(taskId);
