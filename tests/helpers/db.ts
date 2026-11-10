import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { createBookingCapability } from "@/domain/booking";
import { createBookingRepository } from "@/infrastructure/db/booking-repository";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

// Route handlers under test resolve their connection from DATABASE_URL.
process.env.DATABASE_URL = TEST_DATABASE_URL;

/** Seed constants (see supabase/migrations/*_demo_seed_function.sql). */
export const SEED = {
  providerId: "11111111-1111-4111-8111-111111111111",
  serviceId: "22222222-2222-4222-8222-222222222222",
  firstDay: "2026-03-23",
  lastDay: "2026-04-03",
} as const;

export function createTestSql(max = 25): Sql {
  return postgres(TEST_DATABASE_URL, { max, prepare: false, onnotice: () => {} });
}

export function capabilityAt(sql: Sql, now: Date | string) {
  const fixed = new Date(now);
  return createBookingCapability({ repository: createBookingRepository(sql), now: () => fixed });
}

/** A valid-looking idempotency key. */
export const newKey = () => `test-${randomUUID()}`;

/**
 * Creates isolated fixture rows (fresh provider/service ids, so they never
 * collide with seed data or other tests) and removes them on cleanup().
 */
export function fixtures(sql: Sql) {
  const providers: string[] = [];
  const services: string[] = [];

  return {
    async provider(opts: { timezone?: string; active?: boolean; displayName?: string } = {}) {
      const id = randomUUID();
      await sql`
        insert into public.providers (id, display_name, timezone, active)
        values (${id}, ${opts.displayName ?? "Test Provider"}, ${opts.timezone ?? "Europe/Prague"}, ${opts.active ?? true})
      `;
      providers.push(id);
      return id;
    },

    async service(opts: { active?: boolean; name?: string; durationMinutes?: number } = {}) {
      const id = randomUUID();
      await sql`
        insert into public.services (id, name, description, duration_minutes, active)
        values (${id}, ${opts.name ?? `Test Service ${id.slice(0, 8)}`}, 'Fixture', ${opts.durationMinutes ?? 30}, ${opts.active ?? true})
      `;
      services.push(id);
      return id;
    },

    async slot(opts: { serviceId: string; providerId: string; startsAt: string; minutes?: number; active?: boolean }) {
      const id = randomUUID();
      const startsAt = new Date(opts.startsAt);
      const endsAt = new Date(startsAt.getTime() + (opts.minutes ?? 30) * 60_000);
      await sql`
        insert into public.slots (id, service_id, provider_id, starts_at, ends_at, active)
        values (${id}, ${opts.serviceId}, ${opts.providerId}, ${startsAt}, ${endsAt}, ${opts.active ?? true})
      `;
      return id;
    },

    async cleanup() {
      if (providers.length === 0 && services.length === 0) return;
      await sql`
        delete from public.bookings where slot_id in (
          select id from public.slots
          where provider_id = any(${providers}::uuid[]) or service_id = any(${services}::uuid[])
        )
      `;
      await sql`
        delete from public.slots
        where provider_id = any(${providers}::uuid[]) or service_id = any(${services}::uuid[])
      `;
      await sql`delete from public.services where id = any(${services}::uuid[])`;
      await sql`delete from public.providers where id = any(${providers}::uuid[])`;
      providers.length = 0;
      services.length = 0;
    },
  };
}
