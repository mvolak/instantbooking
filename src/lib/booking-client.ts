/**
 * Typed client for the InstantBooking REST API. Framework-free (plain `fetch`),
 * usable from React components today and from other callers later.
 *
 * Every call resolves to a result instead of throwing, so callers handle
 * failures explicitly. Aborted requests (via `signal`) still reject with the
 * standard `AbortError`, which callers should ignore.
 */
import type {
  AvailableDate,
  AvailableSlot,
  Booking,
  BookingErrorCode,
  Service,
  ValidationIssue,
} from "@/domain/booking";

export type ClientErrorCode = BookingErrorCode | "NETWORK_ERROR" | "INTERNAL_ERROR" | (string & {});

export type ApiError = {
  /** HTTP status, or 0 when the server could not be reached. */
  status: number;
  code: ClientErrorCode;
  message: string;
  details?: ValidationIssue[];
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type CreatedBooking = {
  booking: Booking;
  /**
   * Secret for managing the booking. Callers should keep it in memory only for
   * as long as they need it, and never put it in URLs, logs or browser storage.
   */
  managementToken: string;
  /** True when the server recognised an idempotent retry. */
  replayed: boolean;
};

/** Error codes meaning "the chosen slot can no longer be booked". */
export const SLOT_GONE_CODES: readonly ClientErrorCode[] = ["SLOT_ALREADY_BOOKED", "SLOT_UNAVAILABLE", "SLOT_NOT_FOUND"];

export type BookingClient = ReturnType<typeof createBookingClient>;

export function createBookingClient(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T> & { response?: Response }> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, { ...init, headers: { accept: "application/json", ...init.headers } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return {
        ok: false,
        error: { status: 0, code: "NETWORK_ERROR", message: "Could not reach the server. Check your connection." },
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      body = undefined;
    }

    if (response.ok && isObject(body) && "data" in body) {
      return { ok: true, data: body.data as T, response };
    }
    if (isObject(body) && isObject(body.error) && typeof body.error.code === "string") {
      return {
        ok: false,
        error: {
          status: response.status,
          code: body.error.code,
          message: typeof body.error.message === "string" ? body.error.message : "Request failed",
          ...(Array.isArray(body.error.details) ? { details: body.error.details as ValidationIssue[] } : {}),
        },
      };
    }
    return {
      ok: false,
      error: { status: response.status, code: "INTERNAL_ERROR", message: "Unexpected response from the server." },
    };
  }

  return {
    listServices(signal?: AbortSignal) {
      return strip(request<Service[]>("/api/services", { signal }));
    },

    findAvailableDates(serviceId: string, days: number, signal?: AbortSignal) {
      const query = new URLSearchParams({ serviceId, days: String(days) });
      return strip(request<AvailableDate[]>(`/api/availability?${query}`, { signal }));
    },

    findAvailableSlots(serviceId: string, date: string, signal?: AbortSignal) {
      const query = new URLSearchParams({ serviceId, date });
      return strip(request<AvailableSlot[]>(`/api/slots?${query}`, { signal }));
    },

    /**
     * Creates a booking. Pass the same `idempotencyKey` when retrying the same
     * attempt (e.g. after a network failure) so it is never booked twice.
     */
    async createBooking(
      input: { slotId: string; guestName: string },
      idempotencyKey: string,
    ): Promise<ApiResult<CreatedBooking>> {
      const result = await request<{ booking: Booking; managementToken: string }>("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      });
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        data: {
          booking: result.data.booking,
          managementToken: result.data.managementToken,
          replayed: result.response?.headers.get("idempotent-replayed") === "true",
        },
      };
    },
  };
}

async function strip<T>(pending: Promise<ApiResult<T> & { response?: Response }>): Promise<ApiResult<T>> {
  const result = await pending;
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Generates an idempotency key for one booking attempt. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
