import { BookingError, type BookingErrorCode, type ValidationIssue } from "@/domain/booking";

/**
 * Consistent JSON envelope for every API response:
 *   success: { "data": ... }
 *   failure: { "error": { "code": "...", "message": "...", "details"?: [...] } }
 */

const NO_STORE = { "Cache-Control": "no-store" };

const STATUS_BY_CODE: Record<BookingErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  BOOKING_ACCESS_DENIED: 403,
  SERVICE_NOT_FOUND: 404,
  SLOT_NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  SLOT_ALREADY_BOOKED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
};

export function jsonData(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return Response.json({ data }, { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: ValidationIssue[],
  headers?: Record<string, string>,
) {
  return Response.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/** Maps domain errors to HTTP; anything unexpected becomes an opaque 500. */
export function handleError(error: unknown) {
  if (error instanceof BookingError) {
    const status = STATUS_BY_CODE[error.code];
    const headers: Record<string, string> =
      status === 401 ? { "WWW-Authenticate": 'Bearer realm="booking"' } : {};
    return jsonError(status, error.code, error.message, error.details, headers);
  }
  console.error("Unexpected API error", error);
  return jsonError(500, "INTERNAL_ERROR", "Unexpected server error");
}

/**
 * Runs the body of a route handler and renders every thrown error consistently.
 * Call it after Next.js request APIs such as `connection()` so that framework
 * control-flow signals are never caught here.
 */
export async function respond(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (error) {
    return handleError(error);
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BookingError("INVALID_INPUT", "Request body must be valid JSON");
  }
}

/** Extracts a bearer token. Returns "" when the header is missing or not a Bearer credential. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? "";
}
