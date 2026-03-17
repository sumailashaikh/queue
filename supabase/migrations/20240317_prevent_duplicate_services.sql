-- Migration to prevent duplicate service names for the same business
-- This adds a unique constraint on (business_id, name)
-- Note: ilike comparison in the controller handles case-insensitivity, 
-- but this constraint ensures database-level integrity.

-- First, delete existing duplicates (keeping the oldest one)
DELETE FROM public.services a
USING public.services b
WHERE a.id > b.id
  AND a.business_id = b.business_id
  AND LOWER(a.name) = LOWER(b.name);

-- Add the unique constraint
ALTER TABLE public.services
ADD CONSTRAINT services_business_id_name_key UNIQUE (business_id, name);
