-- 26_per_service_workflow.sql
-- Implement granular per-service task tracking and provider locks

-- 1. Create task_status type if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status_type') THEN
        CREATE TYPE public.task_status_type AS ENUM ('pending', 'in_progress', 'done', 'cancelled');
    END IF;
END $$;

-- 2. Add granular tracking columns to queue_entry_services
ALTER TABLE public.queue_entry_services
ADD COLUMN IF NOT EXISTS assigned_provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS task_status public.task_status_type DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS estimated_end_at TIMESTAMPTZ;

-- 3. Add index for busy provider check
CREATE INDEX IF NOT EXISTS idx_qes_provider_status ON public.queue_entry_services(assigned_provider_id, task_status)
WHERE task_status = 'in_progress';

-- 4. Comments for clarity
COMMENT ON COLUMN public.queue_entry_services.task_status IS 'Granular status for this specific service task';
COMMENT ON COLUMN public.queue_entry_services.started_at IS 'Timestamp when this specific task was started by a provider';
COMMENT ON COLUMN public.queue_entry_services.completed_at IS 'Timestamp when this specific task was marked as done';
COMMENT ON COLUMN public.queue_entry_services.estimated_end_at IS 'Calculated end time based on service duration';
