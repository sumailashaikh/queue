
-- Enable UPDATE and DELETE for Business Owners on Queues

-- 1. Policy for UPDATING Queues
-- "Business owners can update their own business's queues"
CREATE POLICY "Business owners can update queues" 
ON public.queues 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.businesses 
    WHERE id = business_id AND owner_id = auth.uid()
  )
);

-- 2. Policy for DELETING Queues
-- "Business owners can delete their own business's queues"
CREATE POLICY "Business owners can delete queues" 
ON public.queues 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.businesses 
    WHERE id = business_id AND owner_id = auth.uid()
  )
);
