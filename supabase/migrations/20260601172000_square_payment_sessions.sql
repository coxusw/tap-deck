create table if not exists public.tap_deck_payment_sessions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  theme text not null default '',
  token_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'used', 'expired')),
  square_payment_link_id text not null default '',
  square_order_id text not null default '',
  square_payment_id text not null default '',
  square_checkout_url text not null default '',
  amount_cents integer not null default 0,
  currency text not null default 'USD',
  paid_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tap_deck_payment_sessions_order_idx
on public.tap_deck_payment_sessions(square_order_id);

create index if not exists tap_deck_payment_sessions_payment_idx
on public.tap_deck_payment_sessions(square_payment_id);

drop trigger if exists tap_deck_payment_sessions_updated_at on public.tap_deck_payment_sessions;
create trigger tap_deck_payment_sessions_updated_at
before update on public.tap_deck_payment_sessions
for each row execute function public.set_tap_deck_updated_at();

alter table public.tap_deck_payment_sessions enable row level security;
