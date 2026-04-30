alter table if exists public.appointments
add column if not exists employee_id uuid null references public.profiles(id) on delete set null;

create index if not exists idx_appointments_employee_status_start
on public.appointments(employee_id, status, start_time);
