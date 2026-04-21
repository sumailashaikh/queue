ALTER TABLE public.queue_entry_services
ADD COLUMN IF NOT EXISTS needs_reassignment BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.appointments
DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE public.appointments
ADD CONSTRAINT appointments_status_check
CHECK (
  status IN (
    'scheduled',
    'confirmed',
    'checked_in',
    'in_service',
    'completed',
    'cancelled',
    'no_show',
    'pending',
    'rescheduled',
    'requested',
    'needs_attention'
  )
);

CREATE INDEX IF NOT EXISTS idx_qes_needs_reassignment
ON public.queue_entry_services(needs_reassignment)
WHERE needs_reassignment = true;
