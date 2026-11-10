export type BookingErrorCode =
  | "INVALID_INPUT"
  | "SERVICE_NOT_FOUND"
  | "SLOT_NOT_FOUND"
  | "SLOT_UNAVAILABLE"
  | "SLOT_ALREADY_BOOKED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAUTHORIZED"
  | "BOOKING_ACCESS_DENIED";

export type ValidationIssue = { path: string; message: string };

/** Expected, channel-independent business error. Adapters map `code` to their transport. */
export class BookingError extends Error {
  readonly code: BookingErrorCode;
  readonly details?: ValidationIssue[];

  constructor(code: BookingErrorCode, message: string, details?: ValidationIssue[]) {
    super(message);
    this.name = "BookingError";
    this.code = code;
    this.details = details;
  }
}
