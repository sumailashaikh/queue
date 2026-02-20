-- 25_add_service_provider_management.sql
-- Create tables for generic Service Provider Management

-- 1. Create service_providers table
CREATE TABLE IF NOT EXISTS public.service_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT, -- Generic role (e.g., Stylist, Doctor, Mechanic)
    department TEXT, -- Optional department
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create provider_services junction table
CREATE TABLE IF NOT EXISTS public.provider_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider_id, service_id)
);

-- 3. Create provider_availability table
CREATE TABLE IF NOT EXISTS public.provider_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3.5 Add assigned_provider_id to queue_entry_services for per-service tracking
ALTER TABLE public.queue_entry_services
ADD COLUMN IF NOT EXISTS assigned_provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL;

-- 4. Add assigned_provider_id to queue_entries
ALTER TABLE public.queue_entries 
ADD COLUMN IF NOT EXISTS assigned_provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS service_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS estimated_end_at TIMESTAMPTZ;

-- 5. Add assigned_provider_id to appointments (for consistency in Phase 2)
-- ALTER TABLE public.appointments
-- ADD COLUMN IF NOT EXISTS assigned_provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL;

-- 6. RLS Policies
-- Enable RLS
ALTER TABLE public.service_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_availability ENABLE ROW LEVEL SECURITY;

-- Service Providers Policies
CREATE POLICY "Owners can manage their own service providers"
    ON public.service_providers FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.businesses 
        WHERE id = public.service_providers.business_id 
        AND owner_id = auth.uid()
    ));

CREATE POLICY "Public can view active providers"
    ON public.service_providers FOR SELECT
    USING (is_active = true);

-- Provider Services Policies
CREATE POLICY "Owners can manage provider services"
    ON public.provider_services FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.service_providers sp
        JOIN public.businesses b ON sp.business_id = b.id
        WHERE sp.id = public.provider_services.provider_id
        AND b.owner_id = auth.uid()
    ));

CREATE POLICY "Public can view provider services"
    ON public.provider_services FOR SELECT
    USING (true);

-- Provider Availability Policies
CREATE POLICY "Owners can manage provider availability"
    ON public.provider_availability FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.service_providers sp
        JOIN public.businesses b ON sp.business_id = b.id
        WHERE sp.id = public.provider_availability.provider_id
        AND b.owner_id = auth.uid()
    ));

CREATE POLICY "Public can view provider availability"
    ON public.provider_availability FOR SELECT
    USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_service_providers_business ON public.service_providers(business_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_provider ON public.provider_services(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_service ON public.provider_services(service_id);
CREATE INDEX IF NOT EXISTS idx_queue_entries_provider ON public.queue_entries(assigned_provider_id);
CREATE INDEX IF NOT EXISTS idx_queue_entry_services_provider ON public.queue_entry_services(assigned_provider_id);
-- CREATE INDEX IF NOT EXISTS idx_appointments_provider ON public.appointments(assigned_provider_id);
