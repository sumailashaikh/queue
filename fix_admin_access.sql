-- Definitive Fix for 403 Forbidden and Role Constraints
-- Run this in your Supabase SQL Editor

-- 1. Remove the restrictive role constraint if it exists
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Add the corrected constraint that includes 'owner'
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
CHECK (role IN ('admin', 'owner', 'staff', 'customer'));

-- 3. Diagnostic: See all users and their roles to identify the correct ID
-- This will help you verify if the phone number matches exactly
SELECT id, full_name, role, phone FROM public.profiles;

-- 4. Aggressive Promotion: Update Rahul to Admin using multiple phone formats
-- Just in case there's a + or missing prefix
UPDATE public.profiles 
SET role = 'admin' 
WHERE phone IN ('918320582350', '+918320582350', '8320582350');

-- 5. Verification: Check if the update worked
SELECT id, full_name, role, phone 
FROM public.profiles 
WHERE role = 'admin';
