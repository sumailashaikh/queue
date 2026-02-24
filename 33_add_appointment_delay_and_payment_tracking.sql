-- Migration 33: Add Appointment Delays and Payment Tracking
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS expected_start_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS expected_end_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS delay_minutes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_delayed BOOLEAN DEFAULT false;

-- Add payment capture flags to queue_entries and appointments
ALTER TABLE public.queue_entries
ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('cash', 'qr', 'card', 'unpaid')) DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) DEFAULT 0.00;

ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('cash', 'qr', 'card', 'unpaid')) DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) DEFAULT 0.00;

-- Staff leave tracking table
CREATE TABLE IF NOT EXISTS public.staff_leaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    leave_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS for staff_leaves
ALTER TABLE public.staff_leaves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their business staff leaves" ON public.staff_leaves;

CREATE POLICY "Users can manage their business staff leaves"
    ON public.staff_leaves
    FOR ALL
    USING (
        auth.uid() IN (
            SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'
            UNION
            SELECT owner_id FROM public.businesses WHERE id = staff_leaves.business_id
        )
    );
