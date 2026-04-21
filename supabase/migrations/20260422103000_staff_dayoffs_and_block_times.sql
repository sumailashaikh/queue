CREATE TABLE IF NOT EXISTS public.provider_day_offs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day_off_date date NOT NULL,
  day_off_type text NOT NULL DEFAULT 'full_day' CHECK (day_off_type IN ('full_day', 'partial')),
  start_time time NULL,
  end_time time NULL,
  reason text NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_day_off_unique_full
ON public.provider_day_offs(provider_id, day_off_date, day_off_type, COALESCE(start_time::text, ''), COALESCE(end_time::text, ''));

CREATE INDEX IF NOT EXISTS idx_provider_day_off_lookup
ON public.provider_day_offs(provider_id, day_off_date);

CREATE TABLE IF NOT EXISTS public.provider_block_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  block_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  reason text NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_provider_block_lookup
ON public.provider_block_times(provider_id, block_date, start_time, end_time);
