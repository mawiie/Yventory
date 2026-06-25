create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.items
add column if not exists location_id uuid references public.storage_locations(id) on delete set null,
add column if not exists location_details text;

alter table public.storage_locations enable row level security;

drop policy if exists "storage_locations select authenticated" on public.storage_locations;
create policy "storage_locations select authenticated"
on public.storage_locations for select
to authenticated
using (true);

drop policy if exists "storage_locations manage staff" on public.storage_locations;
create policy "storage_locations manage staff"
on public.storage_locations for all
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

insert into public.storage_locations (name, is_default)
values
  ('YMEN garage', true),
  ('Clubhouse', true),
  ('PW office', true),
  ('Stitch n’Style', true),
  ('Library', true),
  ('Dungeon', true),
  ('Lockers', true),
  ('Back Shed - Parking Lot', true),
  ('Freezer - Parking Lot', true),
  ('Freezer - Farm', true),
  ('Bike Box', true),
  ('Shed - Community Garden', true),
  ('Mike’s Office', true),
  ('Will’s Office', true),
  ('Farm', true),
  ('Incubator', true),
  ('Trout Garage/House', true),
  ('Kim’s Garage', true)
on conflict (name) do update
set is_default = true;
