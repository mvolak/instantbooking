import { afterAll, afterEach, describe, expect, it } from "vitest";
import { capabilityAt, createTestSql, fixtures, newKey } from "../helpers/db";
import { sha256Hex } from "@/domain/booking/tokens";

// A large pool so concurrent requests really run on separate connections.
const sql = createTestSql(25);
const fx = fixtures(sql);
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

const capability = capabilityAt(sql, "2026-06-01T12:00:00Z");
const PARALLEL = 20;

async function freshSlot() {
  const providerId = await fx.provider();
  const serviceId = await fx.service();
  return fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
}

describe("concurrent booking requests (real PostgreSQL)", () => {
  it("lets exactly one of many simultaneous requests for one slot succeed", async () => {
    const slotId = await freshSlot();

    const results = await Promise.allSettled(
      Array.from({ length: PARALLEL }, (_, i) => capability.createBooking(slotId, `Guest ${i}`, newKey())),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(PARALLEL - 1);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: "SLOT_ALREADY_BOOKED" });

    const [{ count }] = await sql`
      select count(*)::int as count from public.bookings where slot_id = ${slotId} and status = 'confirmed'
    `;
    expect(count).toBe(1);
  });

  it("collapses simultaneous retries with one idempotency key into a single booking", async () => {
    const slotId = await freshSlot();
    const key = newKey();

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () => capability.createBooking(slotId, "Jana", key)),
    );

    const ids = new Set(results.map((r) => r.booking.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);

    const rows = await sql`select management_token_hash from public.bookings where slot_id = ${slotId}`;
    expect(rows).toHaveLength(1);

    // Each replay rotated the token; exactly one issued token (the last write) is valid.
    const valid = results.filter((r) => sha256Hex(r.managementToken) === rows[0].management_token_hash);
    expect(valid).toHaveLength(1);
    await expect(capability.getBooking(valid[0].booking.id, valid[0].managementToken)).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  it("handles a mix of distinct requests and retries racing for one slot", async () => {
    const slotId = await freshSlot();
    const sharedKey = newKey();

    const results = await Promise.allSettled([
      ...Array.from({ length: 10 }, () => capability.createBooking(slotId, "Retry", sharedKey)),
      ...Array.from({ length: 10 }, (_, i) => capability.createBooking(slotId, `Other ${i}`, newKey())),
    ]);

    const [{ count }] = await sql`
      select count(*)::int as count from public.bookings where slot_id = ${slotId} and status = 'confirmed'
    `;
    expect(count).toBe(1);

    const winners = new Set(
      results.flatMap((r) => (r.status === "fulfilled" ? [r.value.booking.id] : [])),
    );
    expect(winners.size).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(["SLOT_ALREADY_BOOKED", "IDEMPOTENCY_KEY_REUSED"]).toContain(r.reason.code);
      }
    }
  });
});
