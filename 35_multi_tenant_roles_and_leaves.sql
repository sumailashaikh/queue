-- 35_multi_tenant_roles_and_leaves.sql
-- 1. Standardize Profiles for Multi-Tenancy
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS phone TEXT;

-- Standardize pending_registrations
ALTER TABLE public.pending_registrations
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- Update role check constraint
-- First drop existing constraint if possible, but standard init_db.sql used check (role in (...))
-- We'll try to find the constraint name or just add a new one if it fails.
DO $$ 
BEGIN 
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'owner', 'employee', 'staff', 'customer'));
EXCEPTION 
    WHEN others THEN 
        NULL; -- Ignore if constraint doesn't exist or name is different
END $$;

-- 2. Link Service Providers to Auth Users
ALTER TABLE public.service_providers 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Update Leave Management
-- Ensure provider_leaves exists first (it should if scripts/fix_provider_leaves_schema.sql was run)
-- If not, we'll create it here as a safety measure.
CREATE TABLE IF NOT EXISTS public.provider_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    leave_type TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.provider_leaves
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);

-- 4. Update Queue Completion Tracking
ALTER TABLE public.queue_entries
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS completed_by_id UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS completed_by_role TEXT CHECK (completed_by_role IN ('OWNER', 'EMPLOYEE'));

-- 5. RLS Updates for Multi-Tenancy
-- Basic multi-tenant security: Users can only see data from their own business_id
-- (Note: Standard Supabase RLS policies might already exist, these are enhancements)

-- Enable RLS on provider_leaves if not already
ALTER TABLE public.provider_leaves ENABLE ROW LEVEL SECURITY;

-- Policy for Employees to see their own leaves
CREATE POLICY "Employees can view their own leaves" 
ON public.provider_leaves FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.service_providers sp
        WHERE sp.id = provider_id AND sp.user_id = auth.uid()
    )
);

-- Policy for Employees to apply for leaves
CREATE POLICY "Employees can apply for leaves" 
ON public.provider_leaves FOR INSERT 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.service_providers sp
        WHERE sp.id = provider_id AND sp.user_id = auth.uid()
    )
);

-- Policy for Owners to manage leaves for their business
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Owners can manage leaves for their business" ON public.provider_leaves;
    CREATE POLICY "Owners can manage leaves for their business" 
    ON public.provider_leaves FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id = provider_leaves.business_id AND b.owner_id = auth.uid()
        )
    );
EXCEPTION WHEN others THEN NULL;
END $$;
