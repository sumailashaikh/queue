-- Add entry_date column to queue_entries for easier daily management
ALTER TABLE public.queue_entries 
ADD COLUMN entry_date DATE DEFAULT CURRENT_DATE;

-- Fill existing rows with dates from their joined_at timestamp
UPDATE public.queue_entries 
SET entry_date = joined_at::DATE 
WHERE entry_date IS NULL;
-- Add last_reset_date to queues table
ALTER TABLE public.queues
ADD COLUMN last_reset_date DATE DEFAULT CURRENT_DATE;
