-- Add translations column to services table
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS translations jsonb DEFAULT '{}'::jsonb;
