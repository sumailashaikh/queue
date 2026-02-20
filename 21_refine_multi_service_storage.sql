-- 21_refine_multi_service_storage.sql
-- Refine storage for multiple services in queue entries

-- 1. Update queue_entries with total price and duration
ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS total_price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_duration_minutes INTEGER DEFAULT 0;

-- 2. Refine queue_entry_services junction table
-- We will recreate it if needed or rename columns for consistency
DO $$ 
BEGIN
    -- Rename if old name exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queue_entry_services' AND column_name='entry_id') THEN
        ALTER TABLE public.queue_entry_services RENAME COLUMN entry_id TO queue_entry_id;
    END IF;
END $$;

-- 3. Add snapshots for price and duration, and optional staff assignment
ALTER TABLE public.queue_entry_services
ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS assigned_staff_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 4. Add UNIQUE constraint to prevent duplicate services per entry
-- First remove any existing duplicates just in case (optional/safety)
-- DELETE FROM public.queue_entry_services q1 USING public.queue_entry_services q2 
-- WHERE q1.id > q2.id AND q1.queue_entry_id = q2.queue_entry_id AND q1.service_id = q2.service_id;

ALTER TABLE public.queue_entry_services
DROP CONSTRAINT IF EXISTS queue_entry_services_entry_service_unique;

ALTER TABLE public.queue_entry_services
ADD CONSTRAINT queue_entry_services_entry_service_unique UNIQUE (queue_entry_id, service_id);

-- 5. Create an index for staff assignment if we plan to query by staff frequently
CREATE INDEX IF NOT EXISTS idx_queue_entry_services_staff ON public.queue_entry_services(assigned_staff_id);

-- 6. Comments for clarity
COMMENT ON COLUMN public.queue_entries.total_price IS 'Calculated sum of all services price at the time of entry';
COMMENT ON COLUMN public.queue_entries.total_duration_minutes IS 'Calculated sum of all services duration at the time of entry';
COMMENT ON COLUMN public.queue_entry_services.price IS 'Price of the service at the time it was joined (snapshot)';
COMMENT ON COLUMN public.queue_entry_services.duration_minutes IS 'Duration of the service at the time it was joined (snapshot)';

-- 7. Missing RLS Policies for Public Insertion
-- Public needs to be able to insert into junction tables when joining/booking
CREATE POLICY "Public can insert entry services"
    ON public.queue_entry_services FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Public can insert appointment services"
    ON public.appointment_services FOR INSERT
    WITH CHECK (true);
