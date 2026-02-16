
-- REVERT DEBUG POLICY
DROP POLICY IF EXISTS "Debug: Anyone can see entries" ON public.queue_entries;
