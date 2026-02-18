-- Migration: Add Business Hours and Manual Close status
-- This adds the ability to track when a business is open or closed.

ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS open_time TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS close_time TIME DEFAULT '21:00:00',
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE;

-- Update existing businesses to have default hours if needed
UPDATE businesses 
SET open_time = '09:00:00', 
    close_time = '21:00:00', 
    is_closed = FALSE 
WHERE open_time IS NULL;

-- Add a comment for documentation
COMMENT ON COLUMN businesses.open_time IS 'Store opening time (HH:mm:ss)';
COMMENT ON COLUMN businesses.close_time IS 'Store closing time (HH:mm:ss)';
COMMENT ON COLUMN businesses.is_closed IS 'Manual override to close the business regardless of time';
