-- Enable RLS for Services (already enabled in init_db.sql, but ensuring here)
alter table public.services enable row level security;

-- 1. Insert Policy
create policy "Business owners can insert services" on public.services 
for insert with check (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);

-- 2. Update Policy
create policy "Business owners can update services" on public.services 
for update using (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);

-- 3. Delete Policy
create policy "Business owners can delete services" on public.services 
for delete using (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);
