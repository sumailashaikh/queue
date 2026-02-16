-- Add verification and status fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked'));

-- Auto-verify the main admin (using the current user's ID or role)
UPDATE public.profiles 
SET is_verified = TRUE, status = 'active'
WHERE role = 'admin';

-- Also auto-verify current owners so they don't get locked out during migration
UPDATE public.profiles
SET is_verified = TRUE, status = 'active'
WHERE role = 'owner';
