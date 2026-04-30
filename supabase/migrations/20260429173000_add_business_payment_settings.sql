create table if not exists public.business_payment_settings (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    upi_id text not null,
    qr_code_url text not null,
    qr_type text not null default 'generated',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint business_payment_settings_business_id_key unique (business_id)
);

create index if not exists idx_business_payment_settings_business_id
    on public.business_payment_settings(business_id);
