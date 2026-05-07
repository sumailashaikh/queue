create table if not exists public.employee_blockouts (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid not null references public.service_providers(id) on delete cascade,
    business_id uuid not null references public.businesses(id) on delete cascade,
    reason text not null default 'other',
    note text,
    start_time timestamptz not null,
    end_time timestamptz not null,
    status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
    created_at timestamptz not null default now()
);

create index if not exists idx_employee_blockouts_employee_status
    on public.employee_blockouts (employee_id, status, start_time, end_time);

create index if not exists idx_employee_blockouts_business_status
    on public.employee_blockouts (business_id, status, start_time);

create unique index if not exists uq_employee_blockouts_active_window
    on public.employee_blockouts (employee_id, start_time, end_time)
    where status = 'active';

update public.employee_blockouts
set status = 'completed'
where status = 'active'
  and end_time <= now();
