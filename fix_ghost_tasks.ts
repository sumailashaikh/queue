import { supabase } from './src/config/supabaseClient';

async function fixGhostTasks() {
    console.log("Fixing ghost tasks...");

    // Find all in-progress tasks
    const { data: ghostTasks, error } = await supabase
        .from('queue_entry_services')
        .select(`
            id,
            queue_entries ( status )
        `)
        .eq('task_status', 'in_progress');

    if (error) {
        console.error("Failed to fetch ghost tasks:", error);
        return;
    }

    // Filter ones where the parent entry is completed, cancelled, or skipped
    const tasksToFix = ghostTasks?.filter((t: any) =>
        t.queue_entries && ['completed', 'cancelled', 'skipped', 'no_show'].includes(t.queue_entries.status)
    ) || [];

    console.log(`Found ${tasksToFix.length} ghost tasks to fix.`);

    for (const task of tasksToFix) {
        console.log(`Fixing task ${task.id}... setting to done`);
        const { error: updateError } = await supabase
            .from('queue_entry_services')
            .update({ task_status: 'done' })
            .eq('id', task.id);

        if (updateError) {
            console.error(`Failed to update task ${task.id}:`, updateError.message);
        } else {
            console.log(`Successfully updated task ${task.id}`);
        }
    }

    console.log("Finished fixing ghost tasks.");
}

fixGhostTasks();
