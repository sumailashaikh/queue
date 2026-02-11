-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create specific schemas if needed, but 'public' is default for Supabase

-- 1. Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  full_name text,
  role text check (role in ('admin', 'staff', 'customer')) default 'customer',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Services (what the business offers)
create table public.services (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  duration_minutes integer not null default 30,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Queues (Live queues for services)
create table public.queues (
  id uuid default uuid_generate_v4() primary key,
  service_id uuid references public.services(id) on delete set null,
  name text not null, -- e.g., "Counter 1", "General Queue"
  status text check (status in ('open', 'closed', 'paused')) default 'closed',
  current_wait_time_minutes integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Queue Entries (People in line)
create table public.queue_entries (
  id uuid default uuid_generate_v4() primary key,
  queue_id uuid references public.queues(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null, -- Nullable for guest walk-ins if needed
  customer_name text, -- For guests or quick identification
  status text check (status in ('waiting', 'serving', 'completed', 'cancelled', 'no_show')) default 'waiting',
  position integer not null, -- Simple counter or order
  ticket_number text not null, -- e.g., "A-001"
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  served_at timestamp with time zone,
  completed_at timestamp with time zone
);

-- 5. Appointments (Scheduled bookings)
create table public.appointments (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  service_id uuid references public.services(id) on delete set null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  status text check (status in ('scheduled', 'confirmed', 'completed', 'cancelled')) default 'scheduled',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.queues enable row level security;
alter table public.queue_entries enable row level security;
alter table public.appointments enable row level security;

-- Basic Policies (Adjust as needed)
-- Public read access to services and queues
create policy "Public services are viewable by everyone" on public.services for select using (true);
create policy "Public queues are viewable by everyone" on public.queues for select using (true);

-- Users can read/update their own profile
create policy "Users can see their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

-- Function to handle new user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'customer');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user signup
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
