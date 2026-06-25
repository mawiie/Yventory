create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location_id uuid references public.storage_locations(id) on delete set null,
  location_details text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint collections_location_required check (
    location_id is not null or nullif(trim(coalesce(location_details, '')), '') is not null
  )
);

alter table public.items
add column if not exists collection_id uuid references public.collections(id) on delete set null;

alter table public.collections enable row level security;

drop policy if exists "collections select authenticated" on public.collections;
create policy "collections select authenticated"
on public.collections for select
to authenticated
using (true);

drop policy if exists "collections manage staff" on public.collections;
create policy "collections manage staff"
on public.collections for all
to authenticated
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());
