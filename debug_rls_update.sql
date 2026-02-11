-- Remove old policy to avoid duplicates
drop policy if exists "Owners can update appointments for their business" on public.appointments;

-- Simplified UPDATE Policy
-- Using a direct IN clause instead of EXISTS just in case
create policy "Owners can update appointments for their business" on public.appointments 
for update using (
  business_id in (
    select id from public.businesses where owner_id = auth.uid()
  )
);
