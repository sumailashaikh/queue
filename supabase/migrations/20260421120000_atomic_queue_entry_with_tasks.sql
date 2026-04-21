-- Atomic insert helper for queue entry + task rows.
-- Prevents partial writes where queue_entries exists but queue_entry_services is missing.

create or replace function public.create_queue_entry_with_tasks(
  p_queue_id uuid,
  p_user_id uuid,
  p_customer_name text,
  p_phone text,
  p_service_name text,
  p_status text,
  p_position int,
  p_ticket_number text,
  p_status_token uuid,
  p_entry_date date,
  p_total_price numeric,
  p_total_duration_minutes int,
  p_entry_source text,
  p_assigned_provider_id uuid,
  p_assigned_to uuid,
  p_tasks jsonb
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries%rowtype;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'At least one task is required to create queue entry';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_tasks) as x(service_id uuid)
    where x.service_id is null
  ) then
    raise exception 'Each task must contain a non-null service_id';
  end if;

  insert into public.queue_entries (
    queue_id,
    user_id,
    customer_name,
    phone,
    service_name,
    status,
    position,
    ticket_number,
    status_token,
    entry_date,
    total_price,
    total_duration_minutes,
    entry_source,
    assigned_provider_id,
    assigned_to
  )
  values (
    p_queue_id,
    p_user_id,
    p_customer_name,
    p_phone,
    p_service_name,
    p_status,
    p_position,
    p_ticket_number,
    p_status_token,
    p_entry_date,
    p_total_price,
    p_total_duration_minutes,
    p_entry_source,
    p_assigned_provider_id,
    p_assigned_to
  )
  returning * into v_entry;

  insert into public.queue_entry_services (
    queue_entry_id,
    service_id,
    assigned_provider_id,
    price,
    duration_minutes
  )
  select
    v_entry.id,
    x.service_id,
    coalesce(x.assigned_provider_id, p_assigned_provider_id),
    coalesce(x.price, 0),
    coalesce(x.duration_minutes, 0)
  from jsonb_to_recordset(p_tasks) as x(
    service_id uuid,
    assigned_provider_id uuid,
    price numeric,
    duration_minutes int
  );

  if not exists (
    select 1 from public.queue_entry_services qes where qes.queue_entry_id = v_entry.id
  ) then
    raise exception 'Failed to create queue entry tasks';
  end if;

  return v_entry;
end;
$$;
