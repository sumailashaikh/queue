-- Add completed_at column to appointments table
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
