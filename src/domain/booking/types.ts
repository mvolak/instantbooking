/** Booking domain types. Timestamps are ISO 8601 strings in UTC. */

export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  active: boolean;
};

export type Provider = {
  id: string;
  displayName: string;
  timezone: string;
  active: boolean;
};

export type Slot = {
  id: string;
  serviceId: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

/** A bookable slot as returned to callers. */
export type AvailableSlot = {
  id: string;
  serviceId: string;
  providerId: string;
  providerName: string;
  providerTimezone: string;
  startsAt: string;
  endsAt: string;
  /** Start in the provider's timezone, ISO 8601 with offset, e.g. `2026-03-23T09:00:00+01:00`. */
  startsAtLocal: string;
  endsAtLocal: string;
};

export type BookingStatus = "confirmed" | "cancelled";

/** Public view of a booking. Never contains the management token hash. */
export type Booking = {
  id: string;
  slotId: string;
  serviceId: string;
  serviceName: string;
  providerId: string;
  providerName: string;
  providerTimezone: string;
  startsAt: string;
  endsAt: string;
  /** Start in the provider's timezone, ISO 8601 with offset. */
  startsAtLocal: string;
  endsAtLocal: string;
  guestName: string;
  status: BookingStatus;
  createdAt: string;
};

export type CreateBookingResult = {
  booking: Booking;
  /** Secret granting access to the booking. Returned only to the creating caller. */
  managementToken: string;
  /**
   * True when this was an idempotent retry of an earlier request. The returned
   * token replaces the earlier one, which no longer works.
   */
  replayed: boolean;
};

/**
 * Persistence port. Implemented in `src/infrastructure/db`; the database is
 * responsible for atomicity and uniqueness guarantees.
 */
export interface BookingRepository {
  listActiveServices(): Promise<Service[]>;
  findActiveServiceById(serviceId: string): Promise<Service | null>;
  /** Active, unbooked slots on `date` (in each provider's timezone), starting after `now`. */
  findAvailableSlots(serviceId: string, date: string, now: Date): Promise<AvailableSlot[]>;
  insertBooking(input: {
    slotId: string;
    guestName: string;
    managementTokenHash: string;
    idempotencyKeyHash: string;
    now: Date;
  }): Promise<InsertBookingResult>;
  /**
   * If a booking exists for the idempotency key and matches the request,
   * atomically replace its management token hash and return it.
   */
  replaceTokenForRetry(input: {
    idempotencyKeyHash: string;
    slotId: string;
    guestName: string;
    managementTokenHash: string;
  }): Promise<RetryResult>;
  findBookingById(bookingId: string): Promise<{ booking: Booking; managementTokenHash: string } | null>;
}

export type InsertBookingResult =
  | { kind: "created"; booking: Booking }
  | { kind: "slot_not_found" }
  | { kind: "slot_unavailable" }
  | { kind: "slot_already_booked" }
  | { kind: "idempotency_key_taken" };

export type RetryResult =
  | { kind: "replayed"; booking: Booking }
  | { kind: "payload_mismatch" }
  | { kind: "not_found" };
