create extension if not exists pgcrypto;

create table if not exists public.tap_deck_profiles (
  slug text primary key,
  business_name text not null default '',
  tagline text not null default '',
  about text not null default '',
  links jsonb not null default '{}'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  theme text not null default '',
  logo_path text not null default '',
  qr_path text not null default '',
  vcard_path text not null default '',
  profile jsonb not null default '{}'::jsonb,
  source text not null default 'supabase',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tap_deck_edit_codes (
  slug text primary key references public.tap_deck_profiles(slug) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tap_deck_tokens (
  token_hash text primary key,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tap_deck_submissions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_tap_deck_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tap_deck_profiles_updated_at on public.tap_deck_profiles;
create trigger tap_deck_profiles_updated_at
before update on public.tap_deck_profiles
for each row execute function public.set_tap_deck_updated_at();

drop trigger if exists tap_deck_edit_codes_updated_at on public.tap_deck_edit_codes;
create trigger tap_deck_edit_codes_updated_at
before update on public.tap_deck_edit_codes
for each row execute function public.set_tap_deck_updated_at();

alter table public.tap_deck_profiles enable row level security;
alter table public.tap_deck_edit_codes enable row level security;
alter table public.tap_deck_tokens enable row level security;
alter table public.tap_deck_submissions enable row level security;

insert into storage.buckets (id, name, public)
values ('tap-deck-assets', 'tap-deck-assets', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read Tap-Deck assets" on storage.objects;
create policy "Public can read Tap-Deck assets"
on storage.objects for select
using (bucket_id = 'tap-deck-assets');
