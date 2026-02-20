-- Add granular metrics to queue_entry_services
ALTER TABLE public.queue_entry_services
ADD COLUMN IF NOT EXISTS actual_minutes INTEGER,
ADD COLUMN IF NOT EXISTS delay_minutes INTEGER;

-- Update comments
COMMENT ON COLUMN public.queue_entry_services.actual_minutes IS 'Actual time taken to complete the task in minutes';
COMMENT ON COLUMN public.queue_entry_services.delay_minutes IS 'Delay relative to service duration estimate (actual - estimated)';
