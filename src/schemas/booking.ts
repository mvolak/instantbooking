import { z } from "zod";

/**
 * Input schemas shared by the domain operations and every channel adapter
 * (REST today; AI tools / chat adapters later).
 */

// Accepts any RFC 4122-shaped id. Deterministic seed ids are md5-derived and do
// not carry a valid version nibble, so the strict `z.uuid()` is not used.
export const idSchema = z.guid({ message: "Must be a UUID" });

export const isoDateSchema = z.iso.date({ message: "Must be a date in YYYY-MM-DD format" });

export const guestNameSchema = z
  .string({ message: "Please enter your name" })
  .trim()
  .min(1, { message: "Please enter your name" })
  .max(100, { message: "Name must be at most 100 characters" })
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Name must not contain line breaks or control characters",
  });

/**
 * Client-generated idempotency key (a UUID v4 is recommended). It must be
 * unguessable: replaying it with the same payload rotates and returns the
 * booking's management token.
 */
export const idempotencyKeySchema = z
  .string({ message: "Idempotency key is required" })
  .min(16, { message: "Idempotency key must be at least 16 characters" })
  .max(200, { message: "Idempotency key must be at most 200 characters" })
  .regex(/^[\x21-\x7e]+$/, { message: "Idempotency key must be printable ASCII without spaces" });

export const managementTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, { message: "Malformed management token" });

export const MAX_AVAILABILITY_DAYS = 31;

export const findAvailableDatesInput = z.object({
  serviceId: idSchema,
  days: z
    .number({ message: "days must be a number" })
    .int({ message: "days must be a whole number" })
    .min(1, { message: "days must be at least 1" })
    .max(MAX_AVAILABILITY_DAYS, { message: `days must be at most ${MAX_AVAILABILITY_DAYS}` }),
});

export const findAvailableSlotsInput = z.object({
  serviceId: idSchema,
  date: isoDateSchema,
});

export const createBookingInput = z.object({
  slotId: idSchema,
  guestName: guestNameSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const getSlotInput = z.object({
  slotId: idSchema,
});

export const getBookingInput = z.object({
  bookingId: idSchema,
  managementToken: z.string(),
});

/** Body of `POST /api/bookings` (the idempotency key travels in a header). */
export const createBookingBody = z.object({
  slotId: idSchema,
  guestName: guestNameSchema,
});
