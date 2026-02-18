-- Add guest columns to appointments table for public bookings
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS guest_name TEXT,
ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- Make user_id nullable for guest appointments
ALTER TABLE public.appointments 
ALTER COLUMN user_id DROP NOT NULL;
