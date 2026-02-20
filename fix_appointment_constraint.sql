-- Fix Appointment Status Constraint
DO $$ 
BEGIN 
    ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
EXCEPTION 
    WHEN others THEN NULL; 
END $$;

ALTER TABLE public.appointments 
ADD CONSTRAINT appointments_status_check 
CHECK (status IN ('scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'pending'));
