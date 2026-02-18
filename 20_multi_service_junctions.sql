-- Create junction table for Queue Entry Services
CREATE TABLE IF NOT EXISTS public.queue_entry_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES public.queue_entries(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create junction table for Appointment Services
CREATE TABLE IF NOT EXISTS public.appointment_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.queue_entry_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_queue_entry_services_entry_id ON public.queue_entry_services(entry_id);
CREATE INDEX IF NOT EXISTS idx_appointment_services_appointment_id ON public.appointment_services(appointment_id);

-- Policies for queue_entry_services
CREATE POLICY "Public can view entry services"
    ON public.queue_entry_services FOR SELECT
    USING (true);

CREATE POLICY "Owners can manage entry services"
    ON public.queue_entry_services FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.queue_entries qe
            JOIN public.queues q ON qe.queue_id = q.id
            JOIN public.businesses b ON q.business_id = b.id
            WHERE qe.id = queue_entry_services.entry_id
            AND b.owner_id = auth.uid()
        )
    );

-- Policies for appointment_services
CREATE POLICY "Users can view own appointment services"
    ON public.appointment_services FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.appointments a
            WHERE a.id = appointment_services.appointment_id
            AND (a.user_id = auth.uid() OR EXISTS (
                SELECT 1 FROM public.businesses b
                WHERE b.id = a.business_id AND b.owner_id = auth.uid()
            ))
        )
    );

CREATE POLICY "Owners can manage appointment services"
    ON public.appointment_services FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.appointments a
            JOIN public.businesses b ON a.business_id = b.id
            WHERE a.id = appointment_services.appointment_id
            AND b.owner_id = auth.uid()
        )
    );
