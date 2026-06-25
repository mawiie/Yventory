alter table public.items
add column if not exists visibility text not null default 'all';

alter table public.collections
add column if not exists visibility text not null default 'all';

do $$
begin
  alter table public.items
  add constraint items_visibility_check
  check (visibility in ('all', 'staff', 'admin'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.collections
  add constraint collections_visibility_check
  check (visibility in ('all', 'staff', 'admin'));
exception
  when duplicate_object then null;
end $$;

create or replace function public.can_view_inventory_visibility(target_visibility text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when target_visibility = 'all' then auth.uid() is not null
    when target_visibility = 'staff' then public.is_staff_or_admin()
    when target_visibility = 'admin' then public.is_admin()
    else false
  end
$$;

drop policy if exists "items select authenticated" on public.items;
create policy "items select authenticated"
on public.items for select
to authenticated
using (public.can_view_inventory_visibility(visibility));

drop policy if exists "collections select authenticated" on public.collections;
create policy "collections select authenticated"
on public.collections for select
to authenticated
using (public.can_view_inventory_visibility(visibility));

drop policy if exists "item_tags select authenticated" on public.item_tags;
create policy "item_tags select authenticated"
on public.item_tags for select
to authenticated
using (
  exists (
    select 1
    from public.items
    where items.id = item_tags.item_id
      and public.can_view_inventory_visibility(items.visibility)
  )
);

drop policy if exists "item_photos select authenticated" on public.item_photos;
create policy "item_photos select authenticated"
on public.item_photos for select
to authenticated
using (
  exists (
    select 1
    from public.items
    where items.id = item_photos.item_id
      and public.can_view_inventory_visibility(items.visibility)
  )
);

drop policy if exists "stock_adjustments select staff" on public.stock_adjustments;
create policy "stock_adjustments select staff"
on public.stock_adjustments for select
to authenticated
using (
  public.is_staff_or_admin()
  and exists (
    select 1
    from public.items
    where items.id = stock_adjustments.item_id
      and public.can_view_inventory_visibility(items.visibility)
  )
);

drop policy if exists "inventory photos view authenticated" on storage.objects;
create policy "inventory photos view authenticated"
on storage.objects for select
to authenticated
using (
  bucket_id = 'inventory-photos'
  and exists (
    select 1
    from public.item_photos
    join public.items on items.id = item_photos.item_id
    where item_photos.storage_path = storage.objects.name
      and public.can_view_inventory_visibility(items.visibility)
  )
);
