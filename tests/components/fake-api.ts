import type { AvailableDate, AvailableSlot, Booking, Service } from "@/domain/booking";
import { createBookingClient } from "@/lib/booking-client";

/**
 * In-memory stand-in for the REST API at the `fetch` level, so component tests
 * exercise the real booking client and the real widget together.
 */

export const SERVICE: Service = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Initial Physiotherapy Consultation",
  description: "A 30-minute first visit: assessment of your condition, goals and a treatment plan.",
  durationMinutes: 30,
  active: true,
};

export const TOKEN = "SECRET_management_token_never_render_0123456";

/** A slot on a CET (UTC+1) date: local 09:00 is 08:00Z. */
export function slot(date: string, localTime: string, id = `slot-${date}-${localTime}`): AvailableSlot {
  const [h, m] = localTime.split(":").map(Number);
  const startUtc = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - 1, m));
  const endUtc = new Date(startUtc.getTime() + 30 * 60_000);
  const local = (d: Date) => {
    const shifted = new Date(d.getTime() + 60 * 60_000);
    return `${shifted.toISOString().slice(0, 19)}+01:00`;
  };
  return {
    id,
    serviceId: SERVICE.id,
    providerId: "11111111-1111-4111-8111-111111111111",
    providerName: "Motion Studio",
    providerTimezone: "Europe/Prague",
    startsAt: startUtc.toISOString(),
    endsAt: endUtc.toISOString(),
    startsAtLocal: local(startUtc),
    endsAtLocal: local(endUtc),
  };
}

type Call = { method: string; path: string; query: URLSearchParams; headers: Headers; body: unknown };
type Reply = Response | Promise<Response>;
type Handler = (call: Call) => Reply;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export function createFakeApi(
  initial: { services?: Service[]; slots?: Record<string, AvailableSlot[]>; days?: string[] } = {},
) {
  const services = initial.services ?? [SERVICE];
  const slotsByDate: Record<string, AvailableSlot[]> = structuredClone(initial.slots ?? {});
  const days = initial.days ?? Object.keys(slotsByDate).sort();
  const bookingsByKey = new Map<string, Booking>();
  const calls: Call[] = [];
  const overrides = new Map<string, Handler[]>();

  const defaults: Record<string, Handler> = {
    "GET /api/services": () => json(200, { data: services }),
    "GET /api/availability": () =>
      json(200, {
        data: days.map((date): AvailableDate => ({ date, availableSlots: slotsByDate[date]?.length ?? 0 })),
      }),
    "GET /api/slots": ({ query }) => json(200, { data: slotsByDate[query.get("date") ?? ""] ?? [] }),
    "POST /api/bookings": ({ headers, body }) => {
      const key = headers.get("idempotency-key") ?? "";
      const { slotId, guestName } = body as { slotId: string; guestName: string };
      const replay = bookingsByKey.get(key);
      if (replay) {
        return json(200, { data: { booking: replay, managementToken: TOKEN } }, { "idempotent-replayed": "true" });
      }
      const date = Object.keys(slotsByDate).find((d) => slotsByDate[d].some((s) => s.id === slotId));
      if (!date) return json(409, { error: { code: "SLOT_ALREADY_BOOKED", message: "Slot has already been booked" } });
      const taken = slotsByDate[date].find((s) => s.id === slotId)!;
      slotsByDate[date] = slotsByDate[date].filter((s) => s.id !== slotId);
      const booking = bookingFor(taken, guestName.trim());
      bookingsByKey.set(key, booking);
      return json(201, { data: { booking, managementToken: TOKEN } });
    },
  };

  const fetchFn: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const call: Call = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const route = `${method} ${url.pathname}`;
    const queue = overrides.get(route);
    const handler = queue?.length ? queue.shift()! : defaults[route];
    if (!handler) return json(404, { error: { code: "NOT_FOUND", message: "No route" } });
    const signal = init.signal;
    const reply = Promise.resolve(handler(call));
    if (!signal) return reply;
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      reply.then(resolve, reject);
    });
  };

  return {
    client: createBookingClient({ fetch: fetchFn }),
    calls,
    slotsByDate,
    /** Handle the next request to `METHOD /path` with `handler` (one-shot; queue several for repeated use). */
    once(route: string, handler: Handler) {
      overrides.set(route, [...(overrides.get(route) ?? []), handler]);
    },
    callsTo(route: string) {
      return calls.filter((c) => `${c.method} ${c.path}` === route);
    },
    /** Simulates another visitor taking a slot. */
    takeSlot(slotId: string) {
      for (const date of Object.keys(slotsByDate)) slotsByDate[date] = slotsByDate[date].filter((s) => s.id !== slotId);
    },
  };
}

export function bookingFor(s: AvailableSlot, guestName: string): Booking {
  return {
    id: "5e3d1753-029d-4093-820a-86127db983a8",
    slotId: s.id,
    serviceId: s.serviceId,
    serviceName: SERVICE.name,
    providerId: s.providerId,
    providerName: s.providerName,
    providerTimezone: s.providerTimezone,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    startsAtLocal: s.startsAtLocal,
    endsAtLocal: s.endsAtLocal,
    guestName,
    status: "confirmed",
    createdAt: "2026-11-10T10:00:00.000Z",
  };
}
