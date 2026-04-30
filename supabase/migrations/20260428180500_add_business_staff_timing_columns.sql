ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS staff_open_time time DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS staff_close_time time DEFAULT '21:00:00';

UPDATE public.businesses
SET
  staff_open_time = COALESCE(staff_open_time, open_time, '09:00:00'::time),
  staff_close_time = COALESCE(staff_close_time, close_time, '21:00:00'::time)
WHERE staff_open_time IS NULL OR staff_close_time IS NULL;
