import type { z } from "zod";
import {
  createBookingInput,
  findAvailableDatesInput,
  findAvailableSlotsInput,
  getBookingInput,
  getSlotInput,
  managementTokenSchema,
} from "@/schemas/booking";
import { BookingError } from "./errors";
import { generateManagementToken, sha256Hex, verifyToken } from "./tokens";
import type {
  AvailableDate,
  AvailableSlot,
  Booking,
  BookingRepository,
  CreateBookingResult,
  RetryResult,
  Service,
  SlotDetails,
} from "./types";

export type BookingCapabilityDeps = {
  repository: BookingRepository;
  /** Injectable clock; defaults to the system clock. */
  now?: () => Date;
};

export type BookingCapability = ReturnType<typeof createBookingCapability>;

// Dummy hash compared against when a booking does not exist, so that "unknown
// booking" and "wrong token" take comparable time and look identical.
const NO_BOOKING_HASH = sha256Hex("no-booking");

/**
 * The booking capability: four deterministic, channel-independent operations.
 * Every adapter (REST, AI tools, chat platforms) calls these and nothing else.
 */
export function createBookingCapability({ repository, now = () => new Date() }: BookingCapabilityDeps) {
  async function listServices(): Promise<Service[]> {
    return repository.listActiveServices();
  }

  async function findAvailableSlots(serviceId: string, date: string): Promise<AvailableSlot[]> {
    const input = parse(findAvailableSlotsInput, { serviceId, date });
    const service = await repository.findActiveServiceById(input.serviceId);
    if (!service) {
      throw new BookingError("SERVICE_NOT_FOUND", "Service not found");
    }
    return repository.findAvailableSlots(input.serviceId, input.date, now());
  }

  /**
   * Per-day availability counts for the next `days` provider-local days, starting
   * today. Lets callers pick the next bookable date without probing each day.
   */
  async function findAvailableDates(serviceId: string, days = 14): Promise<AvailableDate[]> {
    const input = parse(findAvailableDatesInput, { serviceId, days });
    const service = await repository.findActiveServiceById(input.serviceId);
    if (!service) {
      throw new BookingError("SERVICE_NOT_FOUND", "Service not found");
    }
    return repository.findAvailableDates(input.serviceId, input.days, now());
  }

  /**
   * One slot by id with its service and current bookability. Read-only; lets a
   * channel show exactly what is about to be booked before asking to confirm.
   */
  async function getSlot(slotId: string): Promise<SlotDetails> {
    const input = parse(getSlotInput, { slotId });
    const slot = await repository.findSlotById(input.slotId, now());
    if (!slot) {
      throw new BookingError("SLOT_NOT_FOUND", "Slot not found");
    }
    return slot;
  }

  async function createBooking(
    slotId: string,
    guestName: string,
    idempotencyKey: string,
  ): Promise<CreateBookingResult> {
    const input = parse(createBookingInput, { slotId, guestName, idempotencyKey });
    const idempotencyKeyHash = sha256Hex(input.idempotencyKey);
    const managementToken = generateManagementToken();
    const managementTokenHash = sha256Hex(managementToken);

    const retry = () =>
      repository.replaceTokenForRetry({
        idempotencyKeyHash,
        slotId: input.slotId,
        guestName: input.guestName,
        managementTokenHash,
      });

    // 1. Idempotent retry of an earlier request?
    const previous = await retry();
    if (previous.kind !== "not_found") {
      return replayed(previous, managementToken);
    }

    // 2. Atomic insert; the database enforces slot and key uniqueness.
    const inserted = await repository.insertBooking({
      slotId: input.slotId,
      guestName: input.guestName,
      managementTokenHash,
      idempotencyKeyHash,
      now: now(),
    });

    switch (inserted.kind) {
      case "created":
        return { booking: inserted.booking, managementToken, replayed: false };
      case "slot_not_found":
        throw new BookingError("SLOT_NOT_FOUND", "Slot not found");
      case "slot_unavailable":
        throw new BookingError("SLOT_UNAVAILABLE", "Slot is not available for booking");
      case "slot_already_booked":
      case "idempotency_key_taken": {
        // A concurrent request may have won the race with the same idempotency
        // key; if so this is a retry, not a conflict.
        const concurrent = await retry();
        if (concurrent.kind !== "not_found") {
          return replayed(concurrent, managementToken);
        }
        if (inserted.kind === "slot_already_booked") {
          throw new BookingError("SLOT_ALREADY_BOOKED", "Slot has already been booked");
        }
        throw new Error("Idempotency key conflict could not be resolved");
      }
    }
  }

  async function getBooking(bookingId: string, managementToken: string): Promise<Booking> {
    const input = parse(getBookingInput, { bookingId, managementToken });
    if (input.managementToken.length === 0) {
      throw new BookingError("UNAUTHORIZED", "Management token is required");
    }
    const found = await repository.findBookingById(input.bookingId);
    const tokenOk =
      managementTokenSchema.safeParse(input.managementToken).success &&
      verifyToken(input.managementToken, found?.managementTokenHash ?? NO_BOOKING_HASH);
    if (!found || !tokenOk) {
      throw new BookingError("BOOKING_ACCESS_DENIED", "Booking not found or access denied");
    }
    return found.booking;
  }

  return { listServices, findAvailableDates, findAvailableSlots, getSlot, createBooking, getBooking };
}

function replayed(result: Exclude<RetryResult, { kind: "not_found" }>, managementToken: string): CreateBookingResult {
  if (result.kind === "payload_mismatch") {
    throw new BookingError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key was already used for a different booking request",
    );
  }
  return { booking: result.booking, managementToken, replayed: true };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BookingError(
      "INVALID_INPUT",
      "Invalid input",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}
