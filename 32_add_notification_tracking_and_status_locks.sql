-- Migration 32: Add notification tracking and refine appointment statuses

-- 1. Add notification tracking columns to queue_entries
ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS notified_join BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notified_top3 BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notified_next BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notified_noshow BOOLEAN DEFAULT FALSE;

-- 2. Refine appointment status constraints to match latest requirement
-- Requirement: scheduled → confirmed → checked_in → in_service → completed (+ cancelled, no_show)
DO $$ 
BEGIN 
    ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
EXCEPTION 
    WHEN others THEN NULL; 
END $$;

ALTER TABLE public.appointments 
ADD CONSTRAINT appointments_status_check 
CHECK (status IN (
    'scheduled',
    'confirmed',
    'checked_in',
    'in_service',
    'completed',
    'cancelled',
    'no_show'
));

COMMENT ON COLUMN public.appointments.status IS 'Status flow: scheduled → confirmed → checked_in → in_service → completed';
