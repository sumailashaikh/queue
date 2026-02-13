
-- Temporarily allow anyone (even anon) to do everything on queue entries for local debugging
DROP POLICY IF EXISTS "Debug: Anyone can see entries" ON public.queue_entries;
CREATE POLICY "Debug: Anyone can see entries" 
ON public.queue_entries 
FOR ALL -- This includes SELECT, INSERT, UPDATE, DELETE
USING (true)
WITH CHECK (true);
