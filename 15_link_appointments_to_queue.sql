-- Link appointments to queue entries
ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_queue_entries_appointment_id ON public.queue_entries(appointment_id);
