import { PostgresError, type Sql } from "postgres";
import type {
  AvailableSlot,
  Booking,
  BookingRepository,
  BookingStatus,
  InsertBookingResult,
  RetryResult,
  Service,
} from "@/domain/booking/types";
import { toLocalIso } from "@/domain/booking/time";

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  active: boolean;
};

type SlotRow = {
  id: string;
  service_id: string;
  provider_id: string;
  provider_name: string;
  provider_timezone: string;
  starts_at: Date;
  ends_at: Date;
};

type BookingRow = {
  id: string;
  slot_id: string;
  service_id: string;
  service_name: string;
  provider_id: string;
  provider_name: string;
  provider_timezone: string;
  starts_at: Date;
  ends_at: Date;
  guest_name: string;
  status: BookingStatus;
  created_at: Date;
  management_token_hash: string;
};

const UNIQUE_VIOLATION = "23505";

/** PostgreSQL implementation of the booking persistence port. */
export function createBookingRepository(sql: Sql): BookingRepository {
  /** Booking joined with its slot, service and provider. */
  const bookingSelect = (where: ReturnType<Sql>) => sql<BookingRow[]>`
    select b.id, b.slot_id, s.service_id, sv.name as service_name, s.provider_id,
           p.display_name as provider_name, p.timezone as provider_timezone, s.starts_at, s.ends_at, b.guest_name,
           b.status, b.created_at, b.management_token_hash
    from public.bookings b
    join public.slots s on s.id = b.slot_id
    join public.services sv on sv.id = s.service_id
    join public.providers p on p.id = s.provider_id
    where ${where}
  `;

  return {
    async listActiveServices() {
      const rows = await sql<ServiceRow[]>`
        select id, name, description, duration_minutes, active
        from public.services
        where active
        order by name, id
      `;
      return rows.map(toService);
    },

    async findActiveServiceById(serviceId) {
      const [row] = await sql<ServiceRow[]>`
        select id, name, description, duration_minutes, active
        from public.services
        where id = ${serviceId} and active
      `;
      return row ? toService(row) : null;
    },

    async findAvailableSlots(serviceId, date, now) {
      // The calendar date is interpreted in each provider's own timezone; the
      // half-open [local midnight, next local midnight) range is DST-correct.
      const rows = await sql<SlotRow[]>`
        select s.id, s.service_id, s.provider_id, p.display_name as provider_name,
               p.timezone as provider_timezone, s.starts_at, s.ends_at
        from public.slots s
        join public.providers p on p.id = s.provider_id
        join public.services sv on sv.id = s.service_id
        where s.service_id = ${serviceId}
          and s.active and p.active and sv.active
          and s.starts_at > ${now}
          and s.starts_at >= (${date}::date::timestamp at time zone p.timezone)
          and s.starts_at < ((${date}::date + 1)::timestamp at time zone p.timezone)
          and not exists (
            select 1 from public.bookings b
            where b.slot_id = s.id and b.status = 'confirmed'
          )
        order by s.starts_at, p.display_name, s.id
      `;
      return rows.map(toAvailableSlot);
    },

    async findAvailableDates(serviceId, days, now) {
      // "Today" is the earliest current local date among the service's providers
      // (UTC if it has none). Each slot is counted on its provider-local date,
      // with exactly the same filters as findAvailableSlots.
      const rows = await sql<{ date: string; available_slots: number }[]>`
        with first_day as (
          select coalesce(
            min((${now}::timestamptz at time zone p.timezone)::date),
            (${now}::timestamptz at time zone 'UTC')::date
          ) as day
          from public.providers p
          where p.active
            and exists (select 1 from public.slots s where s.provider_id = p.id and s.service_id = ${serviceId})
        ),
        calendar as (
          select f.day + offs as day
          from first_day f, generate_series(0, ${days}::int - 1) as offs
        ),
        free as (
          select (s.starts_at at time zone p.timezone)::date as day
          from public.slots s
          join public.providers p on p.id = s.provider_id
          join public.services sv on sv.id = s.service_id
          where s.service_id = ${serviceId}
            and s.active and p.active and sv.active
            and s.starts_at > ${now}::timestamptz
            and s.starts_at < ${now}::timestamptz + make_interval(days => ${days}::int + 2)
            and not exists (
              select 1 from public.bookings b
              where b.slot_id = s.id and b.status = 'confirmed'
            )
        )
        select to_char(c.day, 'YYYY-MM-DD') as date, count(f.day)::int as available_slots
        from calendar c
        left join free f on f.day = c.day
        group by c.day
        order by c.day
      `;
      return rows.map((row) => ({ date: row.date, availableSlots: row.available_slots }));
    },

    async findSlotById(slotId, now) {
      const [row] = await sql<(SlotRow & { service_name: string; available: boolean })[]>`
        select s.id, s.service_id, s.provider_id, p.display_name as provider_name,
               p.timezone as provider_timezone, s.starts_at, s.ends_at, sv.name as service_name,
               (s.active and p.active and sv.active and s.starts_at > ${now}
                and not exists (
                  select 1 from public.bookings b
                  where b.slot_id = s.id and b.status = 'confirmed'
                )) as available
        from public.slots s
        join public.providers p on p.id = s.provider_id
        join public.services sv on sv.id = s.service_id
        where s.id = ${slotId}
      `;
      return row ? { ...toAvailableSlot(row), serviceName: row.service_name, available: row.available } : null;
    },

    async insertBooking({ slotId, guestName, managementTokenHash, idempotencyKeyHash, now }) {
      try {
        // Single atomic statement: availability is checked and the row inserted
        // together. Concurrent inserts for the same slot are serialized by the
        // partial unique index `bookings_one_confirmed_per_slot`.
        const [row] = await sql<BookingRow[]>`
          with inserted as (
            insert into public.bookings (slot_id, guest_name, status, management_token_hash, idempotency_key_hash)
            select s.id, ${guestName}, 'confirmed', ${managementTokenHash}, ${idempotencyKeyHash}
            from public.slots s
            join public.services sv on sv.id = s.service_id
            join public.providers p on p.id = s.provider_id
            where s.id = ${slotId} and s.active and sv.active and p.active and s.starts_at > ${now}
            returning *
          )
          select i.id, i.slot_id, s.service_id, sv.name as service_name, s.provider_id,
                 p.display_name as provider_name, p.timezone as provider_timezone, s.starts_at, s.ends_at, i.guest_name,
                 i.status, i.created_at, i.management_token_hash
          from inserted i
          join public.slots s on s.id = i.slot_id
          join public.services sv on sv.id = s.service_id
          join public.providers p on p.id = s.provider_id
        `;
        if (row) {
          return { kind: "created", booking: toBooking(row) } satisfies InsertBookingResult;
        }
      } catch (error) {
        if (error instanceof PostgresError && error.code === UNIQUE_VIOLATION) {
          if (error.constraint_name === "bookings_one_confirmed_per_slot") {
            return { kind: "slot_already_booked" };
          }
          if (error.constraint_name === "bookings_idempotency_key_hash_key") {
            return { kind: "idempotency_key_taken" };
          }
        }
        throw error;
      }

      const [slot] = await sql`select 1 from public.slots where id = ${slotId}`;
      return { kind: slot ? "slot_unavailable" : "slot_not_found" };
    },

    async replaceTokenForRetry({ idempotencyKeyHash, slotId, guestName, managementTokenHash }) {
      const [existing] = await sql<{ id: string; slot_id: string; guest_name: string }[]>`
        select id, slot_id, guest_name from public.bookings
        where idempotency_key_hash = ${idempotencyKeyHash}
      `;
      if (!existing) return { kind: "not_found" } satisfies RetryResult;
      if (existing.slot_id !== slotId || existing.guest_name !== guestName) {
        return { kind: "payload_mismatch" };
      }
      const [updated] = await sql<{ id: string }[]>`
        update public.bookings set management_token_hash = ${managementTokenHash}
        where id = ${existing.id}
        returning id
      `;
      if (!updated) return { kind: "not_found" };
      const [row] = await bookingSelect(sql`b.id = ${existing.id}`);
      return { kind: "replayed", booking: toBooking(row) };
    },

    async findBookingById(bookingId) {
      const [row] = await bookingSelect(sql`b.id = ${bookingId}`);
      return row ? { booking: toBooking(row), managementTokenHash: row.management_token_hash } : null;
    },
  };
}

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    active: row.active,
  };
}

function toAvailableSlot(row: SlotRow): AvailableSlot {
  return {
    id: row.id,
    serviceId: row.service_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerTimezone: row.provider_timezone,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    startsAtLocal: toLocalIso(row.starts_at, row.provider_timezone),
    endsAtLocal: toLocalIso(row.ends_at, row.provider_timezone),
  };
}

/** Maps a row to the public booking view; the token hash is deliberately dropped. */
function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    slotId: row.slot_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerTimezone: row.provider_timezone,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    startsAtLocal: toLocalIso(row.starts_at, row.provider_timezone),
    endsAtLocal: toLocalIso(row.ends_at, row.provider_timezone),
    guestName: row.guest_name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}
