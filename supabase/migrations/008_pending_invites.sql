create table if not exists public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  role public.app_role not null,
  token_hash text not null unique,
  invited_by uuid references public.profiles(id) on delete set null default auth.uid(),
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  constraint pending_invites_role_check check (role in ('admin', 'staff', 'user'))
);

create index if not exists pending_invites_email_idx on public.pending_invites (lower(email));
create index if not exists pending_invites_active_idx
on public.pending_invites (token_hash)
where redeemed_at is null;

alter table public.pending_invites enable row level security;
