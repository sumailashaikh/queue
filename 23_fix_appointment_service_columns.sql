-- 23_fix_appointment_service_columns.sql
-- Add missing snapshot columns to appointment_services junction table

ALTER TABLE public.appointment_services
ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0;

-- Comments for clarity
COMMENT ON COLUMN public.appointment_services.price IS 'Price of the service at the time of booking (snapshot)';
COMMENT ON COLUMN public.appointment_services.duration_minutes IS 'Duration of the service at the time of booking (snapshot)';

-- Ensure UNIQUE constraint for appointment services as well
ALTER TABLE public.appointment_services
DROP CONSTRAINT IF EXISTS appointment_services_appointment_service_unique;

ALTER TABLE public.appointment_services
ADD CONSTRAINT appointment_services_appointment_service_unique UNIQUE (appointment_id, service_id);
