import { BookingError } from "@/domain/booking";
import { getBookingCapability } from "@/infrastructure/booking-capability";
import { createBookingBody } from "@/schemas/booking";
import { jsonData, readJsonBody, respond } from "../_lib/http";

/**
 * POST /api/bookings
 * Headers: Idempotency-Key: <unguessable client-generated key, e.g. a UUID v4>
 * Body:    { "slotId": "...", "guestName": "..." }
 *
 * 201 on creation; 200 with `Idempotent-Replayed: true` on a retry, in which case
 * a fresh management token is issued and any earlier token stops working.
 */
export async function POST(request: Request) {
  return respond(() => createBooking(request));
}

async function createBooking(request: Request): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    throw new BookingError("INVALID_INPUT", "Idempotency-Key header is required", [
      { path: "Idempotency-Key", message: "Idempotency-Key header is required" },
    ]);
  }

  const parsed = createBookingBody.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new BookingError(
      "INVALID_INPUT",
      "Invalid input",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }

  const result = await getBookingCapability().createBooking(
    parsed.data.slotId,
    parsed.data.guestName,
    idempotencyKey,
  );

  return jsonData(
    { booking: result.booking, managementToken: result.managementToken },
    {
      status: result.replayed ? 200 : 201,
      headers: {
        Location: `/api/bookings/${result.booking.id}`,
        ...(result.replayed ? { "Idempotent-Replayed": "true" } : {}),
      },
    },
  );
}
