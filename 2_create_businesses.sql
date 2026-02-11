-- 1. Create Businesses Table
create table public.businesses (
  id uuid default uuid_generate_v4() primary key,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  slug text not null unique, -- for url like app.com/slug
  address text,
  phone text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Add business_id to Services
alter table public.services 
add column business_id uuid references public.businesses(id) on delete cascade;

-- 3. Add business_id to Queues
alter table public.queues 
add column business_id uuid references public.businesses(id) on delete cascade;

-- 4. Add business_id to Appointments
alter table public.appointments 
add column business_id uuid references public.businesses(id) on delete cascade;

-- 5. Enable RLS on businesses
alter table public.businesses enable row level security;

-- 6. RLS Policies for Businesses
-- Everyone can view businesses (for the slug URL)
create policy "Businesses are viewable by everyone" 
on public.businesses for select using (true);

-- Only owner can update their business
create policy "Owners can update their own business" 
on public.businesses for update using (auth.uid() = owner_id);

-- Only owner can insert (creation logic might happen via API/Server, but good to have)
create policy "Authenticated users can create a business" 
on public.businesses for insert with check (auth.uid() = owner_id);

-- 7. Update Policies for Linked Tables (Services/Queues) to check Business Owner
-- (This ensures only the Business Owner can Create/Update Queues for THEIR business)

-- Example for Services:
create policy "Business owners can insert services" 
on public.services for insert with check (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);

create policy "Business owners can update services" 
on public.services for update using (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);
