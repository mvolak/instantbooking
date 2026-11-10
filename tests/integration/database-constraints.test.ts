import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSql, fixtures } from "../helpers/db";

const sql = createTestSql(3);
const fx = fixtures(sql);
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

const hash = () => randomUUID().replaceAll("-", "").padEnd(64, "0");

let providerId: string;
let serviceId: string;
beforeEach(async () => {
  providerId = await fx.provider();
  serviceId = await fx.service();
});

const insertBooking = (slotId: string, status = "confirmed") => sql`
  insert into public.bookings (slot_id, guest_name, status, management_token_hash, idempotency_key_hash)
  values (${slotId}, 'Direct SQL', ${status}, ${hash()}, ${hash()})
`;

describe("database-enforced invariants (bypassing the application)", () => {
  it("rejects a second confirmed booking for the same slot", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:00:00Z" });
    await insertBooking(slotId);
    await expect(insertBooking(slotId)).rejects.toMatchObject({
      code: "23505",
      constraint_name: "bookings_one_confirmed_per_slot",
    });
    // Cancelled bookings do not block the slot.
    await expect(insertBooking(slotId, "cancelled")).resolves.toBeDefined();
  });

  it("rejects duplicate idempotency keys", async () => {
    const a = await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:00:00Z" });
    const b = await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T09:00:00Z" });
    const key = hash();
    const insert = (slotId: string) => sql`
      insert into public.bookings (slot_id, guest_name, management_token_hash, idempotency_key_hash)
      values (${slotId}, 'Direct SQL', ${hash()}, ${key})
    `;
    await insert(a);
    await expect(insert(b)).rejects.toMatchObject({ code: "23505", constraint_name: "bookings_idempotency_key_hash_key" });
  });

  it("rejects invalid booking status and plaintext-looking token hashes", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:00:00Z" });
    await expect(insertBooking(slotId, "pending")).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      insert into public.bookings (slot_id, guest_name, management_token_hash, idempotency_key_hash)
      values (${slotId}, 'X', 'plain-token', ${hash()})
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("prevents overlapping active slots for the same provider", async () => {
    await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:00:00Z" }); // 08:00–08:30
    await expect(fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:15:00Z" })).rejects.toMatchObject({
      code: "23P01",
      constraint_name: "slots_no_overlap_per_provider",
    });
    // Adjacent slots are fine (half-open ranges).
    await expect(fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:30:00Z" })).resolves.toBeDefined();
    // Inactive slots may overlap, and other providers are independent.
    await expect(fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:15:00Z", active: false })).resolves.toBeDefined();
    const other = await fx.provider();
    await expect(fx.slot({ serviceId, providerId: other, startsAt: "2030-01-07T08:15:00Z" })).resolves.toBeDefined();
  });

  it("prevents re-activating a slot into an overlap", async () => {
    await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:00:00Z" });
    const inactive = await fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:15:00Z", active: false });
    await expect(sql`update public.slots set active = true where id = ${inactive}`).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("stores all instants as timestamptz (absolute UTC instants)", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and column_name in ('starts_at', 'ends_at', 'created_at')
      order by table_name, column_name
    `;
    expect(columns.length).toBeGreaterThanOrEqual(6);
    for (const c of columns) expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("timestamp with time zone");

    // The stored instant does not depend on the session timezone of the writer or reader.
    const slotId = await sql.begin(async (tx) => {
      await tx`set local timezone = 'America/Los_Angeles'`;
      const [row] = await tx<{ id: string }[]>`
        insert into public.slots (service_id, provider_id, starts_at, ends_at)
        values (${serviceId}, ${providerId}, '2030-01-07 09:00 Europe/Prague', '2030-01-07 09:30 Europe/Prague')
        returning id
      `;
      return row.id;
    });
    const [utc] = await sql.begin(async (tx) => {
      await tx`set local timezone = 'Asia/Tokyo'`;
      return tx<{ utc: string }[]>`
        select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as utc from public.slots where id = ${slotId}
      `;
    });
    expect(utc.utc).toBe("2030-01-07T08:00");
  });

  it("rejects slots that end before they start", async () => {
    await expect(fx.slot({ serviceId, providerId, startsAt: "2030-01-07T08:00:00Z", minutes: -30 })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("rejects unknown provider timezones", async () => {
    await expect(fx.provider({ timezone: "Mars/Olympus_Mons" })).rejects.toMatchObject({ code: "22023" });
  });

  it("enforces referential integrity", async () => {
    await expect(insertBooking(randomUUID())).rejects.toMatchObject({ code: "23503" });
    await expect(
      fx.slot({ serviceId: randomUUID(), providerId, startsAt: "2030-01-07T08:00:00Z" }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("does not expose tables or the seed function to Supabase API roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          return tx`select 1 from public.bookings limit 1`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          return tx`select internal.seed_demo_data('2030-01-01')`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
