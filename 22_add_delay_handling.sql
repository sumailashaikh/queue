-- 22_add_delay_handling.sql
-- Add columns for delay tracking in sequential serving model

ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS service_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS estimated_end_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS delay_minutes INTEGER DEFAULT 0;

-- Comments for clarity
COMMENT ON COLUMN public.queue_entries.service_started_at IS 'Timestamp when the staff started serving the customer';
COMMENT ON COLUMN public.queue_entries.estimated_end_at IS 'Calculated end time based on total_duration_minutes at start';
COMMENT ON COLUMN public.queue_entries.actual_duration_minutes IS 'Calculated duration (completed_at - service_started_at) in minutes';
COMMENT ON COLUMN public.queue_entries.delay_minutes IS 'Calculated delay (actual - estimated duration) in minutes';
