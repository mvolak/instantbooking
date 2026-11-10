import { describe, expect, it } from "vitest";
import { createBookingClient } from "@/lib/booking-client";

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  createBookingClient({
    fetch: async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
  });

const booking = { id: "b1" };

describe("booking client", () => {
  it("unwraps the data envelope", async () => {
    await expect(respond(200, { data: [{ id: "s1" }] }).listServices()).resolves.toEqual({ ok: true, data: [{ id: "s1" }] });
  });

  it("returns API errors with status, code, message and details", async () => {
    const result = await respond(400, {
      error: { code: "INVALID_INPUT", message: "Invalid input", details: [{ path: "date", message: "bad" }] },
    }).findAvailableSlots("x", "y");
    expect(result).toEqual({
      ok: false,
      error: { status: 400, code: "INVALID_INPUT", message: "Invalid input", details: [{ path: "date", message: "bad" }] },
    });
  });

  it("maps unreachable servers to NETWORK_ERROR", async () => {
    const client = createBookingClient({ fetch: () => Promise.reject(new TypeError("Failed to fetch")) });
    const result = await client.listServices();
    expect(result).toMatchObject({ ok: false, error: { status: 0, code: "NETWORK_ERROR" } });
  });

  it("maps non-JSON or unexpected responses to INTERNAL_ERROR", async () => {
    await expect(respond(502, "<html>Bad gateway</html>").listServices()).resolves.toMatchObject({
      ok: false,
      error: { status: 502, code: "INTERNAL_ERROR" },
    });
  });

  it("propagates aborts so callers can ignore stale requests", async () => {
    const controller = new AbortController();
    const client = createBookingClient({
      fetch: (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
        ),
    });
    const pending = client.findAvailableSlots("s", "2026-11-12", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends the idempotency key and reports replays", async () => {
    let seen: Headers | undefined;
    const client = createBookingClient({
      fetch: async (_input, init) => {
        seen = new Headers(init?.headers);
        return new Response(JSON.stringify({ data: { booking, managementToken: "t" } }), {
          status: 200,
          headers: { "idempotent-replayed": "true" },
        });
      },
    });
    const result = await client.createBooking({ slotId: "s", guestName: "Jana" }, "key-123");
    expect(seen?.get("idempotency-key")).toBe("key-123");
    expect(seen?.get("content-type")).toBe("application/json");
    expect(result).toEqual({ ok: true, data: { booking, managementToken: "t", replayed: true } });
  });

  it("builds encoded query strings", async () => {
    const urls: string[] = [];
    const client = createBookingClient({
      baseUrl: "https://example.test",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ data: [] }));
      },
    });
    await client.findAvailableDates("svc id", 14);
    await client.findAvailableSlots("svc", "2026-11-12");
    expect(urls).toEqual([
      "https://example.test/api/availability?serviceId=svc+id&days=14",
      "https://example.test/api/slots?serviceId=svc&date=2026-11-12",
    ]);
  });
});
