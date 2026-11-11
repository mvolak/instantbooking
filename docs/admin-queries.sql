-- Everyday admin queries for InstantBooking.
--
-- Where to run: Supabase Studio → SQL Editor (local: http://localhost:55323).
-- Run one query at a time: select it and press Run.
--
-- Seed bookings are recognised by the demo-only rule that their management
-- token is 'seed-token-<id>'. Queries marked "not seed" use that rule.
-- Times are shown in Europe/Prague (the providers' timezone).
--
-- Writes (7 and 8) change data and can't be undone. Be careful on a hosted
-- database: these are meant for the local demo.


-- 1. Overview: how many bookings, by kind and status ------------------------
select
  case when b.management_token_hash = encode(sha256(convert_to('seed-token-' || b.id, 'UTF8')), 'hex')
       then 'seed' else 'real / test' end as kind,
  b.status,
  count(*) as bookings
from public.bookings b
group by 1, 2
order by 1, 2;


-- 2. All bookings, readable (newest first) ----------------------------------
select
  left(upper(replace(b.id::text, '-', '')), 8)                             as reference,
  b.guest_name,
  b.status,
  to_char(s.starts_at at time zone p.timezone, 'Dy DD Mon YYYY HH24:MI')   as appointment,
  sv.name                                                                  as service,
  p.display_name                                                           as provider,
  to_char(b.created_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') as booked_at
from public.bookings b
join public.slots s     on s.id  = b.slot_id
join public.services sv on sv.id = s.service_id
join public.providers p on p.id  = s.provider_id
order by b.created_at desc;


-- 3. Upcoming confirmed appointments ----------------------------------------
select
  to_char(s.starts_at at time zone p.timezone, 'Dy DD Mon HH24:MI') as appointment,
  b.guest_name,
  left(upper(replace(b.id::text, '-', '')), 8)                     as reference,
  sv.name                                                          as service
from public.bookings b
join public.slots s     on s.id  = b.slot_id
join public.services sv on sv.id = s.service_id
join public.providers p on p.id  = s.provider_id
where b.status = 'confirmed'
  and s.starts_at >= now()
order by s.starts_at;


-- 4. Today's schedule (booked and free times) -------------------------------
select
  to_char(s.starts_at at time zone 'Europe/Prague', 'HH24:MI') as time,
  coalesce(b.guest_name, '— free —')                         as guest
from public.slots s
left join public.bookings b on b.slot_id = s.id and b.status = 'confirmed'
where s.active
  and (s.starts_at at time zone 'Europe/Prague')::date = (now() at time zone 'Europe/Prague')::date
order by s.starts_at;


-- 5. Find a booking by its reference ----------------------------------------
select
  b.id,
  b.guest_name,
  b.status,
  to_char(s.starts_at at time zone 'Europe/Prague', 'Dy DD Mon YYYY HH24:MI') as appointment
from public.bookings b
join public.slots s on s.id = b.slot_id
where upper(replace(b.id::text, '-', '')) like '3F9A12BC%';   -- ← put the reference here


-- 6. Booked vs free per day, next 14 days -----------------------------------
select
  to_char((s.starts_at at time zone 'Europe/Prague')::date, 'Dy DD Mon') as day,
  count(*)               as slots,
  count(b.id)            as booked,
  count(*) - count(b.id) as free
from public.slots s
left join public.bookings b on b.slot_id = s.id and b.status = 'confirmed'
where s.active
  and s.starts_at >= now()
  and s.starts_at <  now() + interval '14 days'
group by (s.starts_at at time zone 'Europe/Prague')::date
order by (s.starts_at at time zone 'Europe/Prague')::date;


-- 7. Cancel one booking (keeps the record, frees the time) -------------------
-- Preferred over deleting for a real business: history is kept.
update public.bookings
set status = 'cancelled'
where upper(replace(id::text, '-', '')) like '3F9A12BC%'   -- ← put the reference here
  and status = 'confirmed'
returning id, guest_name, status;


-- 8. Cleanup: delete every booking except the seed bookings ------------------
-- Includes your own test bookings and the ones `npm run test:e2e` creates
-- ("E2E Guest", "E2E Rival"). Slots are kept.

-- 8a. Preview what will be deleted
select
  left(upper(replace(b.id::text, '-', '')), 8) as reference,
  b.guest_name,
  b.created_at
from public.bookings b
where b.management_token_hash <> encode(sha256(convert_to('seed-token-' || b.id, 'UTF8')), 'hex')
order by b.created_at;

-- 8b. Delete them
delete from public.bookings b
where b.management_token_hash <> encode(sha256(convert_to('seed-token-' || b.id, 'UTF8')), 'hex')
returning left(upper(replace(b.id::text, '-', '')), 8) as reference, b.guest_name;


-- Full reset (from a terminal, not SQL):
--   npm run db:reset       wipes everything, rebuilds schema and fixed seed
--   npm run db:seed:demo   adds demo slots and bookings for the coming days
