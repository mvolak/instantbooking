import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { capabilityAt, createTestSql, fixtures, newKey } from "../helpers/db";

const sql = createTestSql(5);
const fx = fixtures(sql);
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

const NOW = "2026-06-01T12:00:00Z";
const capability = capabilityAt(sql, NOW);

let providerId: string;
let serviceId: string;
beforeEach(async () => {
  providerId = await fx.provider({ timezone: "Europe/Prague" });
  serviceId = await fx.service();
});

describe("listServices", () => {
  it("returns active services only", async () => {
    const inactive = await fx.service({ active: false });
    const ids = (await capability.listServices()).map((s) => s.id);
    expect(ids).toContain(serviceId);
    expect(ids).not.toContain(inactive);
  });
});

describe("findAvailableSlots", () => {
  it("returns free, active, future slots for the service and excludes booked ones", async () => {
    const free = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    const booked = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T09:00:00Z" });
    await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T10:00:00Z", active: false });
    const otherService = await fx.service();
    await fx.slot({ serviceId: otherService, providerId, startsAt: "2026-06-10T11:00:00Z" });

    await capability.createBooking(booked, "Jana Nováková", newKey());

    const slots = await capability.findAvailableSlots(serviceId, "2026-06-10");
    expect(slots).toEqual([
      {
        id: free,
        serviceId,
        providerId,
        providerName: "Test Provider",
        providerTimezone: "Europe/Prague",
        startsAt: "2026-06-10T08:00:00.000Z",
        endsAt: "2026-06-10T08:30:00.000Z",
        startsAtLocal: "2026-06-10T10:00:00+02:00",
        endsAtLocal: "2026-06-10T10:30:00+02:00",
      },
    ]);
  });

  it("frees a slot again when its booking is cancelled", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    const { booking } = await capability.createBooking(slotId, "Jana", newKey());
    expect(await capability.findAvailableSlots(serviceId, "2026-06-10")).toEqual([]);
    await sql`update public.bookings set status = 'cancelled' where id = ${booking.id}`;
    expect((await capability.findAvailableSlots(serviceId, "2026-06-10")).map((s) => s.id)).toEqual([slotId]);
  });

  it("excludes past slots", async () => {
    await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T11:00:00Z" }); // 1h before NOW
    const later = await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T13:00:00Z" });
    const slots = await capability.findAvailableSlots(serviceId, "2026-06-01");
    expect(slots.map((s) => s.id)).toEqual([later]);
  });

  it("rejects unknown and inactive services with SERVICE_NOT_FOUND", async () => {
    const inactive = await fx.service({ active: false });
    await expect(capability.findAvailableSlots(inactive, "2026-06-10")).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
    await expect(
      capability.findAvailableSlots("00000000-0000-4000-8000-000000000000", "2026-06-10"),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
  });

  it("excludes slots of inactive providers", async () => {
    const inactiveProvider = await fx.provider({ active: false });
    await fx.slot({ serviceId, providerId: inactiveProvider, startsAt: "2026-06-10T08:00:00Z" });
    expect(await capability.findAvailableSlots(serviceId, "2026-06-10")).toEqual([]);
  });

  describe("timezone handling and date boundaries", () => {
    it("interprets the date as the provider's local day across the DST switch (Europe/Prague)", async () => {
      const t = (iso: string) => fx.slot({ serviceId, providerId, startsAt: iso });
      await t("2026-03-28T22:30:00Z"); // 23:30 CET, Sat 28 March
      const startOfDay = await t("2026-03-28T23:00:00Z"); // 00:00 CET, Sun 29 March
      const endOfDay = await t("2026-03-29T21:30:00Z"); // 23:30 CEST, Sun 29 March (day is 23h long)
      const nextDay = await t("2026-03-29T22:00:00Z"); // 00:00 CEST, Mon 30 March

      const early = capabilityAt(sql, "2026-03-01T00:00:00Z");
      const sunday = await early.findAvailableSlots(serviceId, "2026-03-29");
      expect(sunday.map((s) => s.id)).toEqual([startOfDay, endOfDay]);
      expect(sunday.map((s) => s.startsAt)).toEqual(["2026-03-28T23:00:00.000Z", "2026-03-29T21:30:00.000Z"]);

      const monday = await early.findAvailableSlots(serviceId, "2026-03-30");
      expect(monday.map((s) => s.id)).toEqual([nextDay]);
    });

    it("uses each provider's own timezone for the same service", async () => {
      const newYork = await fx.provider({ timezone: "America/New_York", displayName: "NY Provider" });
      // 23:00 EDT on 10 June = 03:00Z on 11 June → belongs to 10 June in New York.
      const nySlot = await fx.slot({ serviceId, providerId: newYork, startsAt: "2026-06-11T03:00:00Z" });
      // 05:00 CEST on 11 June = 03:00Z on 11 June → belongs to 11 June in Prague.
      const pragueSlot = await fx.slot({ serviceId, providerId, startsAt: "2026-06-11T03:00:00Z" });

      expect((await capability.findAvailableSlots(serviceId, "2026-06-10")).map((s) => s.id)).toEqual([nySlot]);
      expect((await capability.findAvailableSlots(serviceId, "2026-06-11")).map((s) => s.id)).toEqual([pragueSlot]);
    });
  });
});

describe("createBooking", () => {
  it("creates a confirmed booking and returns a management token once", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    const result = await capability.createBooking(slotId, "  Jana Nováková ", newKey());

    expect(result.replayed).toBe(false);
    expect(result.managementToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.booking).toMatchObject({
      slotId,
      serviceId,
      providerId,
      guestName: "Jana Nováková",
      status: "confirmed",
      providerTimezone: "Europe/Prague",
      startsAt: "2026-06-10T08:00:00.000Z",
      endsAt: "2026-06-10T08:30:00.000Z",
      startsAtLocal: "2026-06-10T10:00:00+02:00",
      endsAtLocal: "2026-06-10T10:30:00+02:00",
    });
    expect(result.booking).not.toHaveProperty("managementTokenHash");

    // Only hashes are persisted.
    const [row] = await sql`select management_token_hash, idempotency_key_hash from public.bookings where id = ${result.booking.id}`;
    expect(row.management_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.management_token_hash).not.toContain(result.managementToken);
  });

  it("rejects a second booking for the same slot with SLOT_ALREADY_BOOKED", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    await capability.createBooking(slotId, "First", newKey());
    await expect(capability.createBooking(slotId, "Second", newKey())).rejects.toMatchObject({
      code: "SLOT_ALREADY_BOOKED",
    });
  });

  it("rejects past, inactive and unknown slots", async () => {
    const past = await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T11:00:00Z" });
    const inactive = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z", active: false });
    await expect(capability.createBooking(past, "Jana", newKey())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(capability.createBooking(inactive, "Jana", newKey())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(
      capability.createBooking("00000000-0000-4000-8000-000000000000", "Jana", newKey()),
    ).rejects.toMatchObject({ code: "SLOT_NOT_FOUND" });
  });

  it("rejects slots of inactive services or providers", async () => {
    const inactiveService = await fx.service({ active: false });
    const inactiveProvider = await fx.provider({ active: false });
    const a = await fx.slot({ serviceId: inactiveService, providerId, startsAt: "2026-06-10T08:00:00Z" });
    const b = await fx.slot({ serviceId, providerId: inactiveProvider, startsAt: "2026-06-10T08:00:00Z" });
    await expect(capability.createBooking(a, "Jana", newKey())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(capability.createBooking(b, "Jana", newKey())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("rejects invalid input", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    await expect(capability.createBooking(slotId, "", newKey())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(capability.createBooking(slotId, "Jana", "short")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(capability.createBooking("not-a-uuid", "Jana", newKey())).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  describe("idempotent retries", () => {
    it("returns the same booking with a rotated token; the old token stops working", async () => {
      const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
      const key = newKey();
      const first = await capability.createBooking(slotId, "Jana", key);
      const retry = await capability.createBooking(slotId, "Jana", key);

      expect(retry.replayed).toBe(true);
      expect(retry.booking).toEqual(first.booking);
      expect(retry.managementToken).not.toBe(first.managementToken);

      await expect(capability.getBooking(first.booking.id, retry.managementToken)).resolves.toEqual(first.booking);
      await expect(capability.getBooking(first.booking.id, first.managementToken)).rejects.toMatchObject({
        code: "BOOKING_ACCESS_DENIED",
      });

      const [{ count }] = await sql`select count(*)::int as count from public.bookings where slot_id = ${slotId}`;
      expect(count).toBe(1);
    });

    it("treats guest name whitespace differences as the same request", async () => {
      const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
      const key = newKey();
      const first = await capability.createBooking(slotId, "Jana", key);
      const retry = await capability.createBooking(slotId, " Jana ", key);
      expect(retry.booking.id).toBe(first.booking.id);
    });

    it("rejects reuse of a key for a different request with IDEMPOTENCY_KEY_REUSED", async () => {
      const slotA = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
      const slotB = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T09:00:00Z" });
      const key = newKey();
      await capability.createBooking(slotA, "Jana", key);
      await expect(capability.createBooking(slotB, "Jana", key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
      await expect(capability.createBooking(slotA, "Petr", key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("replays even after the slot has passed", async () => {
      const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
      const key = newKey();
      const first = await capability.createBooking(slotId, "Jana", key);
      const later = capabilityAt(sql, "2026-07-01T00:00:00Z");
      const retry = await later.createBooking(slotId, "Jana", key);
      expect(retry).toMatchObject({ replayed: true, booking: { id: first.booking.id } });
    });
  });
});

describe("getBooking", () => {
  it("returns the booking for a valid token", async () => {
    const slotId = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    const created = await capability.createBooking(slotId, "Jana", newKey());
    const booking = await capability.getBooking(created.booking.id, created.managementToken);
    expect(booking).toEqual(created.booking);
    expect(Object.keys(booking)).not.toContain("managementTokenHash");
  });

  it("denies access with a wrong, malformed or foreign token, or an unknown id", async () => {
    const slotA = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T08:00:00Z" });
    const slotB = await fx.slot({ serviceId, providerId, startsAt: "2026-06-10T09:00:00Z" });
    const a = await capability.createBooking(slotA, "A", newKey());
    const b = await capability.createBooking(slotB, "B", newKey());

    for (const token of [b.managementToken, "x".repeat(43), "garbage", a.managementToken + "x"]) {
      await expect(capability.getBooking(a.booking.id, token)).rejects.toMatchObject({ code: "BOOKING_ACCESS_DENIED" });
    }
    await expect(
      capability.getBooking("00000000-0000-4000-8000-000000000000", a.managementToken),
    ).rejects.toMatchObject({ code: "BOOKING_ACCESS_DENIED" });
    await expect(capability.getBooking(a.booking.id, "")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
