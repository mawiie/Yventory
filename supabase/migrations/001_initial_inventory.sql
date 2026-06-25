create extension if not exists "pgcrypto";

do $$
begin
  create type public.app_role as enum ('admin', 'staff', 'user');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create unique index if not exists tags_lower_name_idx on public.tags (lower(name));

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  quantity integer not null default 0 check (quantity >= 0),
  category_id uuid references public.categories(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_tags (
  item_id uuid not null references public.items(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (item_id, tag_id)
);

create table if not exists public.item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  storage_path text not null unique,
  alt_text text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  delta integer not null check (delta <> 0),
  note text,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    'user'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'staff'), false)
$$;

create or replace function public.prevent_direct_quantity_update()
returns trigger
language plpgsql
as $$
begin
  if old.quantity is distinct from new.quantity
     and coalesce(current_setting('app.adjusting_stock', true), '') <> 'true' then
    raise exception 'Item quantity must be changed through adjust_item_quantity.';
  end if;
  return new;
end;
$$;

create or replace function public.adjust_item_quantity(
  p_item_id uuid,
  p_delta integer,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_quantity integer;
  next_quantity integer;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Only staff can adjust inventory quantities.';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Adjustment amount must be non-zero.';
  end if;

  select quantity into current_quantity
  from public.items
  where id = p_item_id
  for update;

  if current_quantity is null then
    raise exception 'Item not found.';
  end if;

  next_quantity := current_quantity + p_delta;

  if next_quantity < 0 then
    raise exception 'Inventory quantity cannot be reduced below zero.';
  end if;

  perform set_config('app.adjusting_stock', 'true', true);

  update public.items
  set quantity = next_quantity,
      updated_by = auth.uid()
  where id = p_item_id;

  insert into public.stock_adjustments (item_id, delta, note, actor_id)
  values (p_item_id, p_delta, p_note, auth.uid());

  return next_quantity;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_items_updated_at on public.items;
create trigger touch_items_updated_at
before update on public.items
for each row execute function public.touch_updated_at();

drop trigger if exists prevent_direct_quantity_update on public.items;
create trigger prevent_direct_quantity_update
before update on public.items
for each row execute function public.prevent_direct_quantity_update();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.items enable row level security;
alter table public.item_tags enable row level security;
alter table public.item_photos enable row level security;
alter table public.stock_adjustments enable row level security;

drop policy if exists "profiles select authenticated" on public.profiles;
create policy "profiles select authenticated"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_staff_or_admin());

drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or admin"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (
  (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()))
  or public.is_admin()
);

drop policy if exists "categories select authenticated" on public.categories;
create policy "categories select authenticated"
on public.categories for select
to authenticated
using (true);

drop policy if exists "categories manage staff" on public.categories;
create policy "categories manage staff"
on public.categories for all
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

drop policy if exists "tags select authenticated" on public.tags;
create policy "tags select authenticated"
on public.tags for select
to authenticated
using (true);

drop policy if exists "tags manage staff" on public.tags;
create policy "tags manage staff"
on public.tags for all
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

drop policy if exists "items select authenticated" on public.items;
create policy "items select authenticated"
on public.items for select
to authenticated
using (true);

drop policy if exists "items insert staff" on public.items;
create policy "items insert staff"
on public.items for insert
to authenticated
with check (public.is_staff_or_admin());

drop policy if exists "items update staff" on public.items;
create policy "items update staff"
on public.items for update
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

drop policy if exists "items delete staff" on public.items;
create policy "items delete staff"
on public.items for delete
to authenticated
using (public.is_staff_or_admin());

drop policy if exists "item_tags select authenticated" on public.item_tags;
create policy "item_tags select authenticated"
on public.item_tags for select
to authenticated
using (true);

drop policy if exists "item_tags manage staff" on public.item_tags;
create policy "item_tags manage staff"
on public.item_tags for all
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

drop policy if exists "item_photos select authenticated" on public.item_photos;
create policy "item_photos select authenticated"
on public.item_photos for select
to authenticated
using (true);

drop policy if exists "item_photos manage staff" on public.item_photos;
create policy "item_photos manage staff"
on public.item_photos for all
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

drop policy if exists "stock_adjustments select staff" on public.stock_adjustments;
create policy "stock_adjustments select staff"
on public.stock_adjustments for select
to authenticated
using (public.is_staff_or_admin());

drop policy if exists "stock_adjustments insert staff" on public.stock_adjustments;
create policy "stock_adjustments insert staff"
on public.stock_adjustments for insert
to authenticated
with check (public.is_staff_or_admin());

insert into public.categories (name, slug, position)
values
  ('Food', 'food', 10),
  ('Clothing', 'clothing', 20),
  ('Hygiene', 'hygiene', 30),
  ('Household', 'household', 40),
  ('Medical', 'medical', 50),
  ('Other', 'other', 60)
on conflict (slug) do update
set name = excluded.name,
    position = excluded.position;

insert into storage.buckets (id, name, public)
values ('inventory-photos', 'inventory-photos', false)
on conflict (id) do nothing;

drop policy if exists "inventory photos view authenticated" on storage.objects;
create policy "inventory photos view authenticated"
on storage.objects for select
to authenticated
using (bucket_id = 'inventory-photos');

drop policy if exists "inventory photos insert staff" on storage.objects;
create policy "inventory photos insert staff"
on storage.objects for insert
to authenticated
with check (bucket_id = 'inventory-photos' and public.is_staff_or_admin());

drop policy if exists "inventory photos update staff" on storage.objects;
create policy "inventory photos update staff"
on storage.objects for update
to authenticated
using (bucket_id = 'inventory-photos' and public.is_staff_or_admin())
with check (bucket_id = 'inventory-photos' and public.is_staff_or_admin());

drop policy if exists "inventory photos delete staff" on storage.objects;
create policy "inventory photos delete staff"
on storage.objects for delete
to authenticated
using (bucket_id = 'inventory-photos' and public.is_staff_or_admin());
