-- Add whatsapp_number to businesses table
ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

-- Update Business interface in frontend
-- (This will be done via code edit)
