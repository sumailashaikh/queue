-- 1. Update Appointments Status Constraint
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check 
CHECK (status IN ('pending', 'scheduled', 'confirmed', 'completed', 'cancelled'));

-- 2. Add RLS Policies for Queue Entries
-- Allow anyone to join a queue (INSERT)
CREATE POLICY "Anyone can join a queue" ON public.queue_entries
FOR INSERT WITH CHECK (true);

-- Allow everyone to view their own entries or public queue data
CREATE POLICY "Public can view queue entries" ON public.queue_entries
FOR SELECT USING (true);

-- 3. Add RLS Policies for Appointments
-- Allow customers to create appointments
CREATE POLICY "Customers can create appointments" ON public.appointments
FOR INSERT WITH CHECK (true);

-- Allow users to see their own appointments
CREATE POLICY "Users can view their own appointments" ON public.appointments
FOR SELECT USING (auth.uid() = user_id);
