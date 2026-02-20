-- 24_add_delay_alert_tracking.sql
-- Add column to prevent spamming delay notifications

ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS last_alerted_delay_minutes INTEGER DEFAULT 0;

COMMENT ON COLUMN public.queue_entries.last_alerted_delay_minutes IS 'The delay value (in minutes) at which the last notification was sent to prevent duplicate alerts';
