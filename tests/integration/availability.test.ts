import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { GET as getAvailability } from "@/app/api/availability/route";
import { capabilityAt, createTestSql, fixtures, newKey, SEED } from "../helpers/db";

const sql = createTestSql(3);
const fx = fixtures(sql);
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

describe("findAvailableDates", () => {
  it("returns a dense per-day calendar of the seed window with free-slot counts", async () => {
    // Fri 2026-03-20 13:00 in Prague, before the seed window.
    const capability = capabilityAt(sql, "2026-03-20T12:00:00Z");
    const dates = await capability.findAvailableDates(SEED.serviceId, 14);

    expect(dates).toEqual([
      { date: "2026-03-20", availableSlots: 0 },
      { date: "2026-03-21", availableSlots: 0 },
      { date: "2026-03-22", availableSlots: 0 },
      { date: "2026-03-23", availableSlots: 12 }, // 2 booked
      { date: "2026-03-24", availableSlots: 13 }, // 1 booked
      { date: "2026-03-25", availableSlots: 14 },
      { date: "2026-03-26", availableSlots: 13 }, // 1 booked
      { date: "2026-03-27", availableSlots: 14 },
      { date: "2026-03-28", availableSlots: 0 }, // weekend
      { date: "2026-03-29", availableSlots: 0 }, // weekend, DST switch
      { date: "2026-03-30", availableSlots: 14 },
      { date: "2026-03-31", availableSlots: 13 }, // 1 booked
      { date: "2026-04-01", availableSlots: 14 },
      { date: "2026-04-02", availableSlots: 14 },
    ]);
  });

  it("agrees with findAvailableSlots for every day, including partially elapsed today", async () => {
    const capability = capabilityAt(sql, "2026-03-23T08:45:00Z"); // 09:45 in Prague
    const dates = await capability.findAvailableDates(SEED.serviceId, 10);
    expect(dates[0]).toEqual({ date: "2026-03-23", availableSlots: 11 });
    for (const { date, availableSlots } of dates) {
      expect((await capability.findAvailableSlots(SEED.serviceId, date)).length, date).toBe(availableSlots);
    }
  });

  it("starts 'today' in the provider's timezone, not UTC", async () => {
    const providerId = await fx.provider({ timezone: "Pacific/Auckland" });
    const serviceId = await fx.service();
    // 2026-06-01T20:00Z is already 2 June 08:00 in Auckland (NZST, +12).
    await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T22:00:00Z" }); // 2 June 10:00 local
    const dates = await capabilityAt(sql, "2026-06-01T20:00:00Z").findAvailableDates(serviceId, 2);
    expect(dates).toEqual([
      { date: "2026-06-02", availableSlots: 1 },
      { date: "2026-06-03", availableSlots: 0 },
    ]);
  });

  it("excludes booked, inactive and inactive-provider slots", async () => {
    const providerId = await fx.provider({ timezone: "UTC" });
    const inactiveProvider = await fx.provider({ timezone: "UTC", active: false });
    const serviceId = await fx.service();
    const capability = capabilityAt(sql, "2026-06-01T00:00:00Z");
    const booked = await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T09:00:00Z" });
    await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T10:00:00Z" });
    await fx.slot({ serviceId, providerId, startsAt: "2026-06-01T11:00:00Z", active: false });
    await fx.slot({ serviceId, providerId: inactiveProvider, startsAt: "2026-06-01T12:00:00Z" });
    await capability.createBooking(booked, "Jana", newKey());

    expect(await capability.findAvailableDates(serviceId, 1)).toEqual([{ date: "2026-06-01", availableSlots: 1 }]);
  });

  it("validates input", async () => {
    const capability = capabilityAt(sql, "2026-06-01T00:00:00Z");
    for (const days of [0, 32, 1.5, Number.NaN]) {
      await expect(capability.findAvailableDates(SEED.serviceId, days)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const inactive = await fx.service({ active: false });
    await expect(capability.findAvailableDates(inactive, 7)).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
  });
});

describe("GET /api/availability", () => {
  const call = (query: string) => getAvailability(new NextRequest(`http://localhost/api/availability?${query}`));

  it("defaults to 14 days and returns the standard envelope", async () => {
    const res = await call(`serviceId=${SEED.serviceId}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(14);
    expect(data[0]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), availableSlots: expect.any(Number) });
  });

  it("400 on invalid days, 404 on unknown service", async () => {
    expect((await call(`serviceId=${SEED.serviceId}&days=abc`)).status).toBe(400);
    expect((await call(`serviceId=${SEED.serviceId}&days=99`)).status).toBe(400);
    expect((await call(`serviceId=00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });
});
