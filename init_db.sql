-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  full_name text,
  role text check (role in ('admin', 'staff', 'customer')) default 'customer',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Businesses Table
create table if not exists public.businesses (
  id uuid default uuid_generate_v4() primary key,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  slug text not null unique,
  address text,
  phone text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Services (what the business offers)
create table if not exists public.services (
  id uuid default uuid_generate_v4() primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 30,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Queues (Live queues for services)
create table if not exists public.queues (
  id uuid default uuid_generate_v4() primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  name text not null,
  description text,
  status text check (status in ('open', 'closed', 'paused')) default 'closed',
  current_wait_time_minutes integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Queue Entries (People in line)
create table if not exists public.queue_entries (
  id uuid default uuid_generate_v4() primary key,
  queue_id uuid references public.queues(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null,
  customer_name text,
  status text check (status in ('waiting', 'serving', 'completed', 'cancelled', 'no_show')) default 'waiting',
  position integer not null,
  ticket_number text not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  served_at timestamp with time zone,
  completed_at timestamp with time zone
);

-- 7. Appointments (Scheduled bookings)
create table if not exists public.appointments (
  id uuid default uuid_generate_v4() primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade not null,
  service_id uuid references public.services(id) on delete set null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  status text check (status in ('scheduled', 'confirmed', 'completed', 'cancelled')) default 'scheduled',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.services enable row level security;
alter table public.queues enable row level security;
alter table public.queue_entries enable row level security;
alter table public.appointments enable row level security;

-- 9. Basic Policies
create policy "Public services are viewable by everyone" on public.services for select using (true);
create policy "Public queues are viewable by everyone" on public.queues for select using (true);
create policy "Businesses are viewable by everyone" on public.businesses for select using (true);

-- Users can read/update their own profile
create policy "Users can see their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

-- Business Owners Policies
create policy "Owners can update their own business" on public.businesses for update using (auth.uid() = owner_id);
create policy "Authenticated users can create a business" on public.businesses for insert with check (auth.uid() = owner_id);

create policy "Business owners can insert queues" on public.queues for insert with check (
  exists (
    select 1 from public.businesses 
    where id = business_id and owner_id = auth.uid()
  )
);

-- Queue Entries Policies
create policy "Authenticated users can join queues" on public.queue_entries for insert with check (auth.role() = 'authenticated');
create policy "Users can see their own queue entries" on public.queue_entries for select using (auth.uid() = user_id);
-- Also allow business owners to see entries for their queues
create policy "Business owners can see entries for their queues" on public.queue_entries for select using (
  exists (
    select 1 from public.queues q
    join public.businesses b on q.business_id = b.id
    where q.id = queue_id and b.owner_id = auth.uid()
  )
);

-- 10. Function to handle new user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'customer');
  return new;
end;
$$ language plpgsql security definer;

-- 11. Trigger for new user signup
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
