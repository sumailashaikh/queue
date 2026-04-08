-- Track appointments that require manual reschedule due to no available provider.
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS needs_reschedule BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_appointments_needs_reschedule ON public.appointments(business_id, needs_reschedule);

