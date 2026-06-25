create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'super_admin', false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'admin'), false)
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'admin', 'staff'), false)
$$;

create or replace function public.can_update_profile_role(
  target_profile_id uuid,
  next_role public.app_role
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  actor_role public.app_role;
  target_role public.app_role;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  select role into target_role
  from public.profiles
  where id = target_profile_id;

  if actor_role is null or target_role is null then
    return false;
  end if;

  if target_profile_id = auth.uid() then
    return next_role = actor_role;
  end if;

  if actor_role = 'super_admin' then
    return target_role <> 'super_admin'
      and next_role in ('admin', 'staff', 'user');
  end if;

  if actor_role = 'admin' then
    return target_role in ('staff', 'user')
      and next_role in ('staff', 'user');
  end if;

  return false;
end;
$$;

drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or admin"
on public.profiles for update
to authenticated
using (public.can_update_profile_role(id, role))
with check (public.can_update_profile_role(id, role));
