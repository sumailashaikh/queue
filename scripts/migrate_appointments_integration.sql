-- Add appointment/queue integration settings to businesses
ALTER TABLE public.businesses 
ADD COLUMN IF NOT EXISTS checkin_creates_queue_entry BOOLEAN DEFAULT true;

-- Ensure appointments table has all necessary fields for status flow and payment sync
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'partially_paid')),
ADD COLUMN IF NOT EXISTS payment_method TEXT,
ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS guest_name TEXT,
ADD COLUMN IF NOT EXISTS guest_phone TEXT,
ADD COLUMN IF NOT EXISTS appointment_token TEXT DEFAULT gen_random_uuid()::text;

-- Index for status tracking and auto-no-show logic
CREATE INDEX IF NOT EXISTS idx_appointments_business_status_time ON public.appointments(business_id, status, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_token ON public.appointments(appointment_token);
