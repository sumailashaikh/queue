-- Keep one source of truth for task assignment.
-- assigned_provider_id already stores the selected service provider/staff for queue tasks.
ALTER TABLE public.queue_entry_services
DROP COLUMN IF EXISTS assigned_staff_id;

