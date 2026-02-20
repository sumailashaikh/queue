-- Migration 28: Advanced Queue Features
-- 1. Add entry_source to queue_entries
ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'online';

-- 2. Update status check constraint for queue_entries to include 'skipped'
-- Note: In Supabase/PostgreSQL, we may need to drop and recreate the constraint if it was named.
-- Checking the schema, it was likely an inline check.
DO $$ 
BEGIN 
    ALTER TABLE public.queue_entries DROP CONSTRAINT IF EXISTS queue_entries_status_check;
EXCEPTION 
    WHEN others THEN NULL; 
END $$;

ALTER TABLE public.queue_entries 
ADD CONSTRAINT queue_entries_status_check 
CHECK (status IN ('waiting', 'serving', 'completed', 'cancelled', 'no_show', 'skipped'));

-- 3. Add checked_in_at to appointments
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS checked_in_at timestamp with time zone;

-- 4. Update status check constraint for appointments to include 'no_show'
DO $$ 
BEGIN 
    ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
EXCEPTION 
    WHEN others THEN NULL; 
END $$;

ALTER TABLE public.appointments 
ADD CONSTRAINT appointments_status_check 
CHECK (status IN ('scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'pending'));

-- 5. Add qr_code_url to businesses for persistent storage of generated QR links
ALTER TABLE public.businesses 
ADD COLUMN IF NOT EXISTS qr_code_url text;

-- 6. Add business_slug index to businesses for public landing page lookups
CREATE INDEX IF NOT EXISTS idx_businesses_slug ON public.businesses(slug);
