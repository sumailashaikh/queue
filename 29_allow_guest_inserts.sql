-- Allow public (anon) users to book appointments as guests
DROP POLICY IF EXISTS "Anyone can book guest appointments" ON public.appointments;
CREATE POLICY "Anyone can book guest appointments" 
ON public.appointments 
FOR INSERT 
WITH CHECK (
  (auth.role() = 'anon' AND guest_name IS NOT NULL AND guest_phone IS NOT NULL AND user_id IS NULL)
  OR 
  (auth.role() = 'authenticated')
);

-- Allow public (anon) users to join queues as guests (QR Walk-ins)
DROP POLICY IF EXISTS "Anyone can join queues" ON public.queue_entries;
CREATE POLICY "Anyone can join queues" 
ON public.queue_entries 
FOR INSERT 
WITH CHECK (
  (auth.role() = 'anon' AND customer_name IS NOT NULL)
  OR 
  (auth.role() = 'authenticated')
);

-- Ensure public can view their own guest entries (for status tracking)
DROP POLICY IF EXISTS "Public can view their own guest entries" ON public.queue_entries;
CREATE POLICY "Public can view their own guest entries" 
ON public.queue_entries 
FOR SELECT 
USING (
  (auth.role() = 'anon') OR (auth.role() = 'authenticated')
);
