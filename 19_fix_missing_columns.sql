-- Migration: Consolidation of missing business columns
-- This ensures whatsapp_number and Business Hours columns are all present.

ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
ADD COLUMN IF NOT EXISTS open_time TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS close_time TIME DEFAULT '21:00:00',
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE;

-- Update existing rows to have sensible defaults
UPDATE businesses SET open_time = '09:00:00' WHERE open_time IS NULL;
UPDATE businesses SET close_time = '21:00:00' WHERE close_time IS NULL;
UPDATE businesses SET is_closed = FALSE WHERE is_closed IS NULL;

-- If you are still seeing "Could not find column" errors, 
-- please run "NOTIFY pgrst, 'reload schema';" in your Supabase SQL editor.
