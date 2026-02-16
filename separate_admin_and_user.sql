-- Clean Separation of Roles and Recursion Fix
-- Run this in Supabase SQL Editor

-- 1. CRITICAL: Fix Recursion (Must be done first)
DROP POLICY IF EXISTS "Admins can see all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Admins can see all profiles" ON public.profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (public.is_admin());

-- 2. DEMOTE RAHUL: Switch Rahul back to 'owner' role
UPDATE public.profiles 
SET role = 'owner', status = 'active', is_verified = true 
WHERE phone IN ('918320582350', '+918320582350', '8320582350');

-- 3. PROMOTE NEW ADMIN:
-- [INSTRUCTION] Niche 'NEW_ADMIN_PHONE' ki jagah apna doosra number dalein 
-- (Pehle us number se ek baar login kar lijiye taaki profile ban jaye)
UPDATE public.profiles 
SET role = 'admin', status = 'active', is_verified = true 
WHERE phone = 'NEW_ADMIN_PHONE'; 

-- 4. VERIFY:
SELECT full_name, role, phone FROM public.profiles WHERE role IN ('admin', 'owner');
