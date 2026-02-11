
-- Enable DELETE for Business Owners
-- Existing policies cover INSERT and SELECT and UPDATE
-- We missed DELETE policy

CREATE POLICY "Owners can delete their own business" 
ON public.businesses 
FOR DELETE 
USING (auth.uid() = owner_id);

-- Also ensure that deleting a business deletes linked queues/services/appointments
-- This is handled by "ON DELETE CASCADE" in the foreign keys, 
-- but we should verify the constraint exists or just rely on RLS allowing the cascade.
-- (Usually RLS checks are done on the top level table, and Cascades happen at system level)
