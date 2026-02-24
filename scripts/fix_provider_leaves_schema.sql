-- Fix Schema: Standardize provider_leaves table
-- This script ensures the table name and column names match the backend controller.

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Drop the table if it exists (caution: this deletes current leave data)
DROP TABLE IF EXISTS public.provider_leaves CASCADE;
DROP TABLE IF EXISTS public.staff_leaves CASCADE; -- Clean up the old mismatched name too

-- 2. Create the standardized provider_leaves table
CREATE TABLE public.provider_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    leave_type TEXT NOT NULL CHECK (leave_type IN ('holiday', 'sick', 'emergency', 'other')),
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Constraint: Prevent overlapping leaves for the same provider
    CONSTRAINT provider_leaves_overlap EXCLUDE USING gist (
        provider_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    )
);

-- Note: If you get an error about "gist" or "daterange", you might need to enable btree_gist extension:
-- CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 3. Enable RLS
ALTER TABLE public.provider_leaves ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policy
CREATE POLICY "Owners can manage leaves for their business"
    ON public.provider_leaves
    FOR ALL
    USING (
        auth.uid() IN (
            SELECT owner_id FROM public.businesses WHERE id = business_id
        )
    );

-- 5. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_provider_leaves_provider ON public.provider_leaves(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_leaves_dates ON public.provider_leaves(start_date, end_date);
