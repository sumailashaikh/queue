-- Migration 31: Add Rescheduled and Requested statuses to Appointments
-- This updates the appointment status check constraint to support the requested statuses.

DO $$ 
BEGIN 
    ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
EXCEPTION 
    WHEN others THEN NULL; 
END $$;

ALTER TABLE public.appointments 
ADD CONSTRAINT appointments_status_check 
CHECK (status IN (
    'requested',   -- New (replaces/maps to pending)
    'confirmed',   -- Existing
    'in_queue',    -- New (replaces checked_in)
    'serving',     -- New (replaces in_service)
    'completed',   -- Existing
    'cancelled',   -- Existing
    'no_show',      -- Existing
    'rescheduled',  -- New
    'pending',      -- Keep for compatibility during transition
    'scheduled',    -- Keep for compatibility during transition
    'checked_in',   -- Keep for compatibility during transition
    'in_service'    -- Keep for compatibility during transition
));

COMMENT ON COLUMN public.appointments.status IS 'Status of the appointment: requested, confirmed, in_queue, serving, completed, cancelled, no_show, rescheduled';
