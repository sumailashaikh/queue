-- Migration: Fix pending_registrations schema and add resignation_requests
-- 0. Ensure helper function exists
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Fix pending_registrations table (Add missing business_id)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pending_registrations' AND column_name='business_id') THEN
        ALTER TABLE public.pending_registrations ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pending_registrations' AND column_name='status') THEN
        ALTER TABLE public.pending_registrations ADD COLUMN status TEXT DEFAULT 'INVITED';
    END IF;
END $$;

-- 2. Create resignation_requests table
CREATE TABLE IF NOT EXISTS public.resignation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    reason TEXT,
    requested_last_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Sync updated_at
DROP TRIGGER IF EXISTS set_timestamp_resignation_requests ON public.resignation_requests;
CREATE TRIGGER set_timestamp_resignation_requests
BEFORE UPDATE ON public.resignation_requests
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

-- 4. Enable RLS
ALTER TABLE public.resignation_requests ENABLE ROW LEVEL SECURITY;

-- 5. Policies for resignation_requests
DROP POLICY IF EXISTS "Employees can view their own resignations" ON public.resignation_requests;
CREATE POLICY "Employees can view their own resignations"
ON public.resignation_requests FOR SELECT
TO authenticated
USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Employees can submit their own resignations" ON public.resignation_requests;
CREATE POLICY "Employees can submit their own resignations"
ON public.resignation_requests FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Owners can view resignations for their business" ON public.resignation_requests;
CREATE POLICY "Owners can view resignations for their business"
ON public.resignation_requests FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.businesses
        WHERE id = resignation_requests.business_id
        AND owner_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Owners can update resignation status for their business" ON public.resignation_requests;
CREATE POLICY "Owners can update resignation status for their business"
ON public.resignation_requests FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.businesses
        WHERE id = resignation_requests.business_id
        AND owner_id = auth.uid()
    )
);
