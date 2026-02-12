-- Add phone and service_name to queue_entries to match frontend UI
ALTER TABLE public.queue_entries 
ADD COLUMN phone TEXT,
ADD COLUMN service_name TEXT;
