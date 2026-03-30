-- Add translations column to service_providers table
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS translations jsonb DEFAULT '{}'::jsonb;
