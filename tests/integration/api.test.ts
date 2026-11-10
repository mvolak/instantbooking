import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `connection()` (which opts handlers out of build-time prerendering) requires a
// live Next.js request scope; handlers are invoked directly here, so make it a no-op.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { createTestSql, fixtures, newKey } from "../helpers/db";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getServices } from "@/app/api/services/route";
import { GET as getSlots } from "@/app/api/slots/route";
import { POST as postBooking } from "@/app/api/bookings/route";
import { GET as getBookingRoute } from "@/app/api/bookings/[id]/route";

// Route handlers use the real clock, so fixtures live far in the future.
const DAY = "2099-01-05";
const BASE = "http://localhost:3000";

const sql = createTestSql(3);
const fx = fixtures(sql);
let serviceId: string;
let slotIds: string[];

beforeAll(async () => {
  const providerId = await fx.provider({ timezone: "UTC", displayName: "API Provider" });
  serviceId = await fx.service({ name: "API Service" });
  slotIds = [];
  for (const time of ["09:00", "09:30", "10:00", "10:30"]) {
    slotIds.push(await fx.slot({ serviceId, providerId, startsAt: `${DAY}T${time}:00Z` }));
  }
});
afterAll(async () => {
  await fx.cleanup();
  await sql.end();
});

const slots = (query: string) => getSlots(new NextRequest(`${BASE}/api/slots?${query}`));

const book = (body: unknown, key: string | null = newKey()) =>
  postBooking(
    new Request(`${BASE}/api/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const fetchBooking = (id: string, authorization?: string) =>
  getBookingRoute(
    new Request(`${BASE}/api/bookings/${id}`, { headers: authorization ? { authorization } : {} }),
    { params: Promise.resolve({ id }) },
  );

describe("REST API", () => {
  it("GET /api/health", async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { status: "ok", database: "ok" } });
  });

  it("GET /api/services", async () => {
    const res = await getServices();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toContainEqual({
      id: serviceId,
      name: "API Service",
      description: "Fixture",
      durationMinutes: 30,
      active: true,
    });
  });

  describe("GET /api/slots", () => {
    it("returns available slots", async () => {
      const res = await slots(`serviceId=${serviceId}&date=${DAY}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { data } = await res.json();
      expect(data.map((s: { id: string }) => s.id)).toEqual(slotIds);
      expect(data[0]).toEqual({
        id: slotIds[0],
        serviceId,
        providerId: expect.any(String),
        providerName: "API Provider",
        providerTimezone: "UTC",
        startsAt: `${DAY}T09:00:00.000Z`,
        endsAt: `${DAY}T09:30:00.000Z`,
        startsAtLocal: `${DAY}T09:00:00+00:00`,
        endsAtLocal: `${DAY}T09:30:00+00:00`,
      });
    });

    it("400 on invalid or missing parameters", async () => {
      for (const query of [`serviceId=${serviceId}&date=05.01.2099`, `serviceId=nope&date=${DAY}`, ""]) {
        const res = await slots(query);
        expect(res.status, query).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe("INVALID_INPUT");
        expect(body.error.details.length).toBeGreaterThan(0);
      }
    });

    it("404 for an unknown service", async () => {
      const res = await slots(`serviceId=${randomUUID()}&date=${DAY}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "SERVICE_NOT_FOUND", message: "Service not found" } });
    });
  });

  describe("POST /api/bookings and GET /api/bookings/{id}", () => {
    it("creates, replays and retrieves a booking", async () => {
      const key = newKey();
      const created = await book({ slotId: slotIds[0], guestName: "Jana Nováková" }, key);
      expect(created.status).toBe(201);
      expect(created.headers.get("cache-control")).toBe("no-store");
      const { data } = await created.json();
      expect(created.headers.get("location")).toBe(`/api/bookings/${data.booking.id}`);
      expect(data.managementToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(data.booking).toMatchObject({ slotId: slotIds[0], guestName: "Jana Nováková", status: "confirmed" });

      // The booked slot disappears from availability.
      const after = await (await slots(`serviceId=${serviceId}&date=${DAY}`)).json();
      expect(after.data.map((s: { id: string }) => s.id)).not.toContain(slotIds[0]);

      // Idempotent retry → 200, same booking, new token.
      const retried = await book({ slotId: slotIds[0], guestName: "Jana Nováková" }, key);
      expect(retried.status).toBe(200);
      expect(retried.headers.get("idempotent-replayed")).toBe("true");
      const replay = (await retried.json()).data;
      expect(replay.booking.id).toBe(data.booking.id);

      const ok = await fetchBooking(data.booking.id, `Bearer ${replay.managementToken}`);
      expect(ok.status).toBe(200);
      const fetched = (await ok.json()).data;
      expect(fetched).toEqual(data.booking);
      expect(JSON.stringify(fetched)).not.toMatch(/hash/i);

      // The superseded token no longer grants access.
      expect((await fetchBooking(data.booking.id, `Bearer ${data.managementToken}`)).status).toBe(403);
    });

    it("409 when the slot is already booked", async () => {
      expect((await book({ slotId: slotIds[1], guestName: "A" })).status).toBe(201);
      const res = await book({ slotId: slotIds[1], guestName: "B" });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("SLOT_ALREADY_BOOKED");
    });

    it("409 when an idempotency key is reused for a different request", async () => {
      const key = newKey();
      expect((await book({ slotId: slotIds[2], guestName: "A" }, key)).status).toBe(201);
      const res = await book({ slotId: slotIds[3], guestName: "A" }, key);
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("404 for an unknown slot", async () => {
      const res = await book({ slotId: randomUUID(), guestName: "A" });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("SLOT_NOT_FOUND");
    });

    it("400 on invalid JSON, invalid body or a missing Idempotency-Key", async () => {
      const cases = [
        book("{not json"),
        book({ slotId: slotIds[3] }),
        book({ slotId: "x", guestName: "A" }),
        book({ slotId: slotIds[3], guestName: "A" }, null),
        book({ slotId: slotIds[3], guestName: "A" }, "short"),
      ];
      for (const res of await Promise.all(cases)) {
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("INVALID_INPUT");
      }
    });

    it("401 without credentials, 403 with a wrong token or unknown booking, 400 on a malformed id", async () => {
      const created = (await (await book({ slotId: slotIds[3], guestName: "Petr" })).json()).data;
      const id = created.booking.id;

      const missing = await fetchBooking(id);
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate")).toContain("Bearer");
      expect((await fetchBooking(id, `Basic ${created.managementToken}`)).status).toBe(401);

      const wrong = await fetchBooking(id, `Bearer ${"A".repeat(43)}`);
      expect(wrong.status).toBe(403);
      expect((await wrong.json()).error.code).toBe("BOOKING_ACCESS_DENIED");
      expect((await fetchBooking(randomUUID(), `Bearer ${created.managementToken}`)).status).toBe(403);

      expect((await fetchBooking("not-a-uuid", `Bearer ${created.managementToken}`)).status).toBe(400);
      expect((await fetchBooking(id, `Bearer ${created.managementToken}`)).status).toBe(200);
    });
  });
});
