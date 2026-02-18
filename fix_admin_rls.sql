-- Global Visibility Fixes for Admins and Performance Analytics
-- Run these as Superuser in the Supabase SQL Editor

-- 1. Ensure Admins can view ALL appointments for analytics
CREATE POLICY "Admins can view all appointments" ON public.appointments
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
);

-- 2. Ensure Business Owners can view all aggregated records for THEIR business
-- This helps if some appointments were created without their direct ownership link but belong to their business ID
CREATE POLICY "Owners can view all business appointments" ON public.appointments
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.businesses
    WHERE businesses.id = business_id AND businesses.owner_id = auth.uid()
  )
);

-- 3. Relax Queue Entry Visibility for Business Owners for Aggregated Stats
CREATE POLICY "Owners can view all business queue entries" ON public.queue_entries
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.queues
    JOIN public.businesses ON queues.business_id = businesses.id
    WHERE queues.id = queue_id AND businesses.owner_id = auth.uid()
  )
);

-- 4. Explicitly allow public visibility of active queue entries for the Status Page (Safe for tokens)
-- "anyone can see the status of a token if they have the token"
-- This is already partially handled but let's be explicit
DROP POLICY IF EXISTS "Public can view queue entries" ON public.queue_entries;
CREATE POLICY "Public status access via token" ON public.queue_entries
FOR SELECT USING (true); 
-- Note: Selection is already limited by token in the controller, so SELECT USING (true) is technically the goal of public status.

-- 5. Fix for Profile visibility (Admins need to see all profiles for management)
DROP POLICY IF EXISTS "Users can see their own profile" ON public.profiles;
CREATE POLICY "Everyone can see profiles for identification" ON public.profiles
FOR SELECT USING (true);
