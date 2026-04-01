-- 36_fix_task_completion_columns.sql
-- Add missing columns to queue_entry_services to support task completion tracking

ALTER TABLE public.queue_entry_services 
ADD COLUMN IF NOT EXISTS completed_by_id UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS completed_by_role TEXT CHECK (completed_by_role IN ('OWNER', 'EMPLOYEE'));

-- Update comments for clarity
COMMENT ON COLUMN public.queue_entry_services.completed_by_id IS 'Profile ID of the staff/owner who marked this task as done';
COMMENT ON COLUMN public.queue_entry_services.completed_by_role IS 'Role of the person who completed the task';
