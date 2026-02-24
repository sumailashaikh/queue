-- Fix Ghost Tasks
-- This will mark any 'in_progress' service tasks as 'done' if their parent queue entry is no longer waiting or serving.
UPDATE public.queue_entry_services
SET task_status = 'done'
WHERE task_status = 'in_progress'
AND queue_entry_id IN (
    SELECT id 
    FROM public.queue_entries 
    WHERE status IN ('completed', 'cancelled', 'skipped', 'no_show')
);
