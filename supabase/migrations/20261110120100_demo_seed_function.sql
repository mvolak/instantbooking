-- Deterministic, repeatable demo seed.
--
-- internal.seed_demo_data(first_day) upserts the demo provider and service and
-- generates ten working days (Mon–Fri) of 30-minute slots starting at
-- first_day (or the next working day if first_day falls on a weekend), with a
-- handful of them already booked.
--
-- All ids are derived deterministically (md5 -> uuid), and every insert is
-- conflict-tolerant, so calling the function repeatedly never creates duplicates.
--
-- The `internal` schema is not exposed through the Supabase Data API.

create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

create function internal.seed_demo_data(first_day date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_provider_id constant uuid := '11111111-1111-4111-8111-111111111111';
  v_service_id  constant uuid := '22222222-2222-4222-8222-222222222222';
  v_timezone    constant text := 'Europe/Prague';
  -- Local start times; 30-minute slots, lunch break 12:00–13:00.
  v_times constant time[] := array[
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
  ]::time[];
  -- (working-day index, local time, guest) of pre-booked slots.
  v_occupied constant text[][] := array[
    array['0', '09:00', 'Alice Demo'],
    array['0', '10:30', 'Bob Demo'],
    array['1', '14:00', 'Carla Demo'],
    array['3', '09:30', 'David Demo'],
    array['6', '15:30', 'Eva Demo'],
    array['9', '16:30', 'Filip Demo']
  ];
  v_days date[] := '{}';
  v_day date := first_day;
  v_time time;
  v_starts timestamptz;
  v_slot_id uuid;
  v_booking_id uuid;
  v_slots_inserted integer := 0;
  v_bookings_inserted integer := 0;
  v_rows integer;
  i integer;
begin
  if first_day is null then
    raise exception 'first_day is required' using errcode = '22004';
  end if;

  insert into public.providers (id, display_name, timezone, active)
  values (v_provider_id, 'Motion Studio', v_timezone, true)
  on conflict (id) do update
    set display_name = excluded.display_name, timezone = excluded.timezone, active = true;

  insert into public.services (id, name, description, duration_minutes, active)
  values (
    v_service_id,
    'Initial Physiotherapy Consultation',
    'A 30-minute first visit: assessment of your condition, goals and a treatment plan.',
    30,
    true
  )
  on conflict (id) do update
    set name = excluded.name, description = excluded.description,
        duration_minutes = excluded.duration_minutes, active = true;

  -- Collect ten working days.
  while coalesce(array_length(v_days, 1), 0) < 10 loop
    if extract(isodow from v_day) < 6 then
      v_days := v_days || v_day;
    end if;
    v_day := v_day + 1;
  end loop;

  foreach v_day in array v_days loop
    foreach v_time in array v_times loop
      v_starts := (v_day + v_time) at time zone v_timezone;
      v_slot_id := md5('instantbooking:slot:' || v_provider_id || ':' || extract(epoch from v_starts)::bigint)::uuid;
      insert into public.slots (id, service_id, provider_id, starts_at, ends_at, active)
      values (v_slot_id, v_service_id, v_provider_id, v_starts, v_starts + interval '30 minutes', true)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_slots_inserted := v_slots_inserted + v_rows;
    end loop;
  end loop;

  for i in 1 .. array_length(v_occupied, 1) loop
    v_starts := (v_days[v_occupied[i][1]::int + 1] + v_occupied[i][2]::time) at time zone v_timezone;
    v_slot_id := md5('instantbooking:slot:' || v_provider_id || ':' || extract(epoch from v_starts)::bigint)::uuid;
    v_booking_id := md5('instantbooking:booking:' || v_slot_id)::uuid;
    insert into public.bookings (id, slot_id, guest_name, status, management_token_hash, idempotency_key_hash)
    select v_booking_id, v_slot_id, v_occupied[i][3], 'confirmed',
           encode(sha256(convert_to('seed-token-' || v_booking_id, 'UTF8')), 'hex'),
           encode(sha256(convert_to('seed-idempotency-' || v_booking_id, 'UTF8')), 'hex')
    where exists (select 1 from public.slots where id = v_slot_id)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_bookings_inserted := v_bookings_inserted + v_rows;
  end loop;

  return jsonb_build_object(
    'firstDay', v_days[1],
    'lastDay', v_days[10],
    'slotsInserted', v_slots_inserted,
    'bookingsInserted', v_bookings_inserted
  );
end;
$$;

revoke execute on function internal.seed_demo_data(date) from public, anon, authenticated;
