-- SAFE MIGRATION: Rename columns instead of recreating table to avoid data loss.

-- 1. Enable required extension for overlap prevention (optional/if migration passes)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Rename columns safely if they exist with old names
DO $$ 
BEGIN 
    -- Rename staff_id to provider_id if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='provider_leaves' AND column_name='staff_id') THEN
        ALTER TABLE public.provider_leaves RENAME COLUMN staff_id TO provider_id;
    END IF;

    -- Rename service_provider_id to provider_id if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='provider_leaves' AND column_name='service_provider_id') THEN
        ALTER TABLE public.provider_leaves RENAME COLUMN service_provider_id TO provider_id;
    END IF;

    -- Rename staff_leaves table to provider_leaves if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='staff_leaves') THEN
        ALTER TABLE public.staff_leaves RENAME TO provider_leaves;
    END IF;
END $$;

-- 3. Ensure business_id column exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='provider_leaves' AND column_name='business_id') THEN
        ALTER TABLE public.provider_leaves ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4. Add Indexes for performance
CREATE INDEX IF NOT EXISTS idx_provider_leaves_provider_id ON public.provider_leaves(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_leaves_business_id ON public.provider_leaves(business_id);
CREATE INDEX IF NOT EXISTS idx_provider_leaves_dates ON public.provider_leaves(start_date, end_date);

-- 5. Add Overlap Prevention Constraint (Conditional)
-- This ensures a provider cannot have two overlapping leave entries.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_leaves_overlap') THEN
        ALTER TABLE public.provider_leaves 
        ADD CONSTRAINT provider_leaves_overlap EXCLUDE USING gist (
            provider_id WITH =,
            daterange(start_date, end_date, '[]') WITH &&
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add overlap constraint. Ensure btree_gist is enabled and no current data violates this.';
END $$;
