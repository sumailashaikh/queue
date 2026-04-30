CREATE TABLE IF NOT EXISTS public.provider_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  clock_in_time timestamptz NULL,
  clock_out_time timestamptz NULL,
  clock_in_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  clock_out_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_attendance_unique_day UNIQUE (provider_id, attendance_date),
  CONSTRAINT provider_attendance_clock_order CHECK (clock_out_time IS NULL OR clock_in_time IS NULL OR clock_out_time >= clock_in_time)
);

CREATE INDEX IF NOT EXISTS idx_provider_attendance_provider_date
ON public.provider_attendance(provider_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_provider_attendance_business_date
ON public.provider_attendance(business_id, attendance_date DESC);
