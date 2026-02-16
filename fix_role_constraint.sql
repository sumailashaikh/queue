-- Profiles table ke roles ko update karne ke liye
-- Taaki 'owner' role bhi allow ho sake
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
CHECK (role IN ('admin', 'owner', 'staff', 'customer'));

-- Verify existing data structure
COMMENT ON CONSTRAINT profiles_role_check ON public.profiles IS 'Restricts user roles to admin, owner, staff, or customer';
