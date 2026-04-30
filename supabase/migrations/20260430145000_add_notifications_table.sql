create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    user_id uuid null references public.profiles(id) on delete cascade,
    type text not null default 'general',
    title text not null,
    message text not null,
    meta jsonb not null default '{}'::jsonb,
    is_read boolean not null default false,
    read_at timestamptz null,
    created_at timestamptz not null default now()
);

create index if not exists idx_notifications_business_created
    on public.notifications (business_id, created_at desc);

create index if not exists idx_notifications_user_read
    on public.notifications (user_id, is_read, created_at desc);
