
-- 1. DROP EXISTING POLICIES (to avoid errors if they exist)
DROP POLICY IF EXISTS "Authenticated users can join queues" ON public.queue_entries;
DROP POLICY IF EXISTS "Users can see their own queue entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Business owners can see entries for their queues" ON public.queue_entries;
DROP POLICY IF EXISTS "Anyone can view queue entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Authenticated users can update their own entry" ON public.queue_entries;

-- 2. CREATE NEW POLICIES

-- Allow ANY authenticated user to JOIN a queue (INSERT)
CREATE POLICY "Authenticated users can join queues" 
ON public.queue_entries 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Allow ANY authenticated user to VIEW queue entries (SELECT)
-- This is necessary to calculate your position in the line (e.g. "You are #5")
CREATE POLICY "Anyone can view queue entries" 
ON public.queue_entries 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- Allow users to UPDATE their own entry (e.g. leave queue)
CREATE POLICY "Authenticated users can update their own entry" 
ON public.queue_entries 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Allow business owners to UPDATE entries in their queues (e.g. mark as completed)
CREATE POLICY "Business owners can update entries" 
ON public.queue_entries 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.queues q
    JOIN public.businesses b ON q.business_id = b.id
    WHERE q.id = queue_entries.queue_id AND b.owner_id = auth.uid()
  )
);
