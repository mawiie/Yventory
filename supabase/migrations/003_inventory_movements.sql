alter table public.items
add column if not exists borrowed_quantity integer not null default 0 check (borrowed_quantity >= 0);

alter table public.stock_adjustments
add column if not exists action_type text not null default 'adjustment',
add column if not exists recipient_name text;

create or replace function public.prevent_direct_quantity_update()
returns trigger
language plpgsql
as $$
begin
  if (
    old.quantity is distinct from new.quantity
    or old.borrowed_quantity is distinct from new.borrowed_quantity
  )
  and coalesce(current_setting('app.adjusting_stock', true), '') <> 'true' then
    raise exception 'Item quantities must be changed through adjust_item_quantity.';
  end if;
  return new;
end;
$$;

do $$
begin
  alter table public.stock_adjustments
  add constraint stock_adjustments_action_type_check
  check (action_type in ('initial_stock', 'add_stock', 'lend', 'give_out', 'adjustment'));
exception
  when duplicate_object then null;
end $$;

drop function if exists public.adjust_item_quantity(uuid, integer, text);

create or replace function public.adjust_item_quantity(
  p_item_id uuid,
  p_action text,
  p_quantity integer,
  p_recipient_name text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_quantity integer;
  current_borrowed_quantity integer;
  next_quantity integer;
  next_borrowed_quantity integer;
  movement_delta integer;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Only staff can adjust inventory quantities.';
  end if;

  if p_action not in ('add_stock', 'lend', 'give_out') then
    raise exception 'Inventory action must be add_stock, lend, or give_out.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;

  if p_action in ('lend', 'give_out') and nullif(trim(coalesce(p_recipient_name, '')), '') is null then
    raise exception 'Recipient name is required when lending or giving out inventory.';
  end if;

  select quantity, borrowed_quantity
  into current_quantity, current_borrowed_quantity
  from public.items
  where id = p_item_id
  for update;

  if current_quantity is null then
    raise exception 'Item not found.';
  end if;

  if p_action = 'add_stock' then
    movement_delta := p_quantity;
    next_quantity := current_quantity + p_quantity;
    next_borrowed_quantity := current_borrowed_quantity;
  elsif p_action = 'lend' then
    movement_delta := -p_quantity;
    next_quantity := current_quantity - p_quantity;
    next_borrowed_quantity := current_borrowed_quantity + p_quantity;
  else
    movement_delta := -p_quantity;
    next_quantity := current_quantity - p_quantity;
    next_borrowed_quantity := current_borrowed_quantity;
  end if;

  if next_quantity < 0 then
    raise exception 'Inventory quantity cannot be reduced below zero.';
  end if;

  perform set_config('app.adjusting_stock', 'true', true);

  update public.items
  set quantity = next_quantity,
      borrowed_quantity = next_borrowed_quantity,
      updated_by = auth.uid()
  where id = p_item_id;

  insert into public.stock_adjustments (
    item_id,
    delta,
    action_type,
    recipient_name,
    note,
    actor_id
  )
  values (
    p_item_id,
    movement_delta,
    p_action,
    nullif(trim(coalesce(p_recipient_name, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid()
  );

  return jsonb_build_object(
    'quantity', next_quantity,
    'borrowed_quantity', next_borrowed_quantity
  );
end;
$$;
