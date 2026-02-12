-- Add price column to services table
ALTER TABLE public.services 
ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;

-- Update existing services to have a price of 0 if they don't already
UPDATE public.services SET price = 0 WHERE price IS NULL;
