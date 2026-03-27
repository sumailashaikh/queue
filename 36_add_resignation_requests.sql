-- Migration: Add resignation_requests table and helper function
-- 0. Ensure the timestamp helper function exists
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Create the table
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

-- 2. Sync updated_at
DROP TRIGGER IF EXISTS set_timestamp_resignation_requests ON public.resignation_requests;
CREATE TRIGGER set_timestamp_resignation_requests
BEFORE UPDATE ON public.resignation_requests
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

-- 3. Enable RLS
ALTER TABLE public.resignation_requests ENABLE ROW LEVEL SECURITY;

-- 4. Policies for resignation_requests
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
