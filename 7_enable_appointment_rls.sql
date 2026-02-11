-- Enable RLS for Appointments (already enabled in init_db.sql)
alter table public.appointments enable row level security;

-- 1. INSERT Policy (Customers can book)
create policy "Authenticated users can book appointments" on public.appointments 
for insert with check (
  auth.role() = 'authenticated' and
  auth.uid() = user_id
);

-- 2. SELECT Policy (Customers see own, Owners see their business's)
create policy "Users can see their own appointments" on public.appointments 
for select using (
  auth.uid() = user_id
);

create policy "Owners can see appointments for their business" on public.appointments 
for select using (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);

-- 3. UPDATE Policy (Owners can confirm/cancel, Customers can cancel own - optionally)
-- Allowing owners to update status
create policy "Owners can update appointments for their business" on public.appointments 
for update using (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);

-- Allowing customers to update (e.g. cancel) their own appointments
create policy "Users can update their own appointments" on public.appointments 
for update using (
  auth.uid() = user_id
);
