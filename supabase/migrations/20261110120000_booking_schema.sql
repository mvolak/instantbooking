-- InstantBooking M1 — booking schema
--
-- Consistency guarantees enforced by the database (not only by application code):
--   * slots_no_overlap_per_provider: active slots of one provider can never overlap.
--   * bookings_one_confirmed_per_slot: at most one confirmed booking per slot.
--   * bookings_idempotency_key_hash_key: one booking per idempotency key.
--
-- All tables have RLS enabled with no policies, so the Supabase Data API (anon /
-- authenticated roles) cannot read or write them. The application accesses the
-- database exclusively server-side through a direct Postgres connection.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create table public.services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 200),
  description      text not null default '',
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------
create table public.providers (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  -- IANA timezone name, e.g. 'Europe/Prague'. Validated by trigger below.
  timezone     text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create function public.providers_validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger providers_validate_timezone
  before insert or update of timezone on public.providers
  for each row execute function public.providers_validate_timezone();

-- ---------------------------------------------------------------------------
-- slots
-- ---------------------------------------------------------------------------
create table public.slots (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references public.services (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint slots_ends_after_starts check (ends_at > starts_at),
  -- A provider can never have two overlapping active slots.
  constraint slots_no_overlap_per_provider exclude using gist (
    provider_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (active)
);

create index slots_service_starts_at_idx on public.slots (service_id, starts_at) where active;

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  slot_id               uuid not null references public.slots (id) on delete restrict,
  guest_name            text not null check (length(btrim(guest_name)) between 1 and 100),
  status                text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at            timestamptz not null default now(),
  -- SHA-256 (hex) of the management token. The token itself is never stored.
  management_token_hash text not null check (management_token_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 (hex) of the client-supplied idempotency key. The key doubles as a
  -- credential for recovering access on retry, so it is stored hashed as well.
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  constraint bookings_idempotency_key_hash_key unique (idempotency_key_hash)
);

-- At most one confirmed booking per slot (cancelled bookings free the slot).
create unique index bookings_one_confirmed_per_slot
  on public.bookings (slot_id) where status = 'confirmed';

create index bookings_slot_id_idx on public.bookings (slot_id);

-- ---------------------------------------------------------------------------
-- Lock down the Data API: server-side access only.
-- ---------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.providers enable row level security;
alter table public.slots enable row level security;
alter table public.bookings enable row level security;

revoke all on public.services, public.providers, public.slots, public.bookings from anon, authenticated;
revoke execute on function public.providers_validate_timezone() from public, anon, authenticated;
