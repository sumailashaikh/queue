-- Employee invite tokens (one-time links)
-- Creates a secure, token-based invitation that can be consumed once during OTP verification.

create table if not exists public.employee_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  phone text not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null default 'employee',
  full_name text,
  custom_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid
);

create index if not exists employee_invites_phone_idx on public.employee_invites (phone);
create index if not exists employee_invites_business_idx on public.employee_invites (business_id);
create index if not exists employee_invites_unused_idx on public.employee_invites (token) where used_at is null;

-- Basic RLS: backend typically uses service role, but keep table protected by default.
alter table public.employee_invites enable row level security;

drop policy if exists "service role can manage employee_invites" on public.employee_invites;
create policy "service role can manage employee_invites"
on public.employee_invites
for all
to service_role
using (true)
with check (true);

