-- update appointments status check constraint to include multi-stage workflow
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check 
CHECK (status IN ('pending', 'scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled'));
