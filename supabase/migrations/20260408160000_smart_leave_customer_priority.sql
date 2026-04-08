-- Smart leave + customer priority foundations (safe additive migration).
-- Adds:
-- - provider_leaves: leave_kind + time window + smart-leave metadata
-- - customer flags: VIP marking per business
-- - appointment_services reassignment metadata (if table exists)

-- 1) Extend provider_leaves for advanced leave types
ALTER TABLE public.provider_leaves
ADD COLUMN IF NOT EXISTS leave_kind TEXT DEFAULT 'FULL_DAY', -- FULL_DAY | HALF_DAY | EMERGENCY
ADD COLUMN IF NOT EXISTS start_time TEXT, -- "HH:MM" local time for EMERGENCY/HALF_DAY
ADD COLUMN IF NOT EXISTS end_time TEXT,   -- "HH:MM" local time for EMERGENCY/HALF_DAY
ADD COLUMN IF NOT EXISTS requires_owner_approval BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS smart_impact JSONB; -- cached impact summary for dashboards

-- 2) Customer flags (VIP) per business
CREATE TABLE IF NOT EXISTS public.business_customer_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  vip_note TEXT,
  vip_set_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_bcf_business_customer ON public.business_customer_flags(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_bcf_business_vip ON public.business_customer_flags(business_id, is_vip);

-- 3) Appointment service reassignment metadata (if appointment_services exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointment_services') THEN
    ALTER TABLE public.appointment_services
      ADD COLUMN IF NOT EXISTS assigned_provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reassigned_from_provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_appt_services_assigned_provider ON public.appointment_services(assigned_provider_id);
  END IF;
END $$;

