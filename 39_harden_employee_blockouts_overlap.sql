create extension if not exists btree_gist;

update public.employee_blockouts
set status = 'completed'
where status = 'active'
  and end_time <= now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_blockouts_no_active_overlap'
  ) then
    alter table public.employee_blockouts
      add constraint employee_blockouts_no_active_overlap
      exclude using gist (
        employee_id with =,
        tstzrange(start_time, end_time, '[)') with &&
      )
      where (status = 'active');
  end if;
end $$;
