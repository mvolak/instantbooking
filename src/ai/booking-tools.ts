import { tool, type ModelMessage, type ToolApprovalConfiguration, type ToolInputRefinement } from "ai";
import { z } from "zod";
import { BookingError, bookingReference, type BookingCapability } from "@/domain/booking";
import { guestNameSchema, idSchema, isoDateSchema } from "@/schemas/booking";
import { addDays, daysBetween, localDate, longDate, wallDate, wallTime, weekdayOf } from "./calendar";
import { bookingIdempotencyKey, openBookingAccess, sealBookingAccess } from "./secrets";

/**
 * AI SDK tools over the existing booking capability. The tools only adapt
 * inputs and outputs for the model; every business rule (validation,
 * availability, concurrency, authorization, persistence) stays in the domain.
 */

/** Hard cap on tool executions per chat request, on top of the step limit. */
export const MAX_TOOL_CALLS_PER_REQUEST = 8;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Must be a time in HH:MM format" });

/** Server-computed summary of the slot being booked, shown to the guest for approval. */
const bookingReviewSchema = z.object({
  serviceName: z.string(),
  providerName: z.string(),
  date: z.string(),
  dateLabel: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  timeZone: z.string(),
});
export type BookingReview = z.infer<typeof bookingReviewSchema>;

export type ConfirmedBooking = {
  reference: string;
  serviceName: string;
  providerName: string;
  date: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  guestName: string;
  status: string;
};

export type CreateBookingOutput =
  | {
      status: "confirmed";
      booking: ConfirmedBooking;
      /**
       * Sealed management token, kept in the browser's in-memory conversation so
       * getBooking can authorize later turns. Removed from what the model sees.
       */
      access: string;
    }
  | { status: "slot_unavailable" | "slot_not_found" | "invalid_input" | "limit_reached"; message: string };

type Deps = {
  capability: BookingCapability;
  /** Server signing secret (see `readChatConfig`). */
  secret: string;
  now: () => Date;
  timeZone: string;
  horizonDays: number;
  /** Sealed booking credentials from earlier turns of this conversation. */
  sessionAccess: readonly string[];
};

export function createBookingTools({ capability, secret, now, timeZone, horizonDays, sessionAccess }: Deps) {
  let toolCalls = 0;
  const overLimit = () => ++toolCalls > MAX_TOOL_CALLS_PER_REQUEST;
  const limitReached = {
    status: "limit_reached" as const,
    message: "Too many lookups in one reply. Ask the guest how they would like to continue.",
  };
  // Credentials known to this request: earlier turns plus bookings made now.
  const accessible = [...sessionAccess];

  const toConfirmed = (booking: Awaited<ReturnType<BookingCapability["getBooking"]>>): ConfirmedBooking => ({
    reference: bookingReference(booking.id),
    serviceName: booking.serviceName,
    providerName: booking.providerName,
    date: wallDate(booking.startsAtLocal),
    dateLabel: longDate(wallDate(booking.startsAtLocal)),
    startTime: wallTime(booking.startsAtLocal),
    endTime: wallTime(booking.endsAtLocal),
    timeZone: booking.providerTimezone,
    guestName: booking.guestName,
    status: booking.status,
  });

  /** Rejects dates outside [today, today + horizon) in the studio timezone. */
  function checkDate(date: string): string | null {
    const today = localDate(now(), timeZone);
    const offset = daysBetween(today, date);
    if (offset < 0) return `${longDate(date)} is in the past. Today is ${longDate(today)}.`;
    if (offset >= horizonDays) {
      return `Bookings open at most ${horizonDays} days ahead (until ${longDate(addDays(today, horizonDays - 1))}).`;
    }
    return null;
  }

  const tools = {
    listServices: tool({
      description: "List the services (appointment types) that can be booked.",
      inputSchema: z.object({}),
      execute: async () => {
        if (overLimit()) return limitReached;
        const services = await capability.listServices();
        return {
          status: "ok" as const,
          services: services.map((s) => ({
            serviceId: s.id,
            name: s.name,
            description: s.description,
            durationMinutes: s.durationMinutes,
          })),
        };
      },
    }),

    findAvailableDates: tool({
      description:
        "Count free appointments per day for a service, starting today. Use it to find the next days with availability.",
      inputSchema: z.object({
        serviceId: idSchema.describe("Service id from listServices"),
        days: z.number().int().min(1).max(14).default(14).describe("How many days to check, starting today"),
      }),
      execute: async ({ serviceId, days }) => {
        if (overLimit()) return limitReached;
        try {
          const dates = await capability.findAvailableDates(serviceId, days);
          return {
            status: "ok" as const,
            timeZone,
            days: dates.map((d) => ({ date: d.date, dateLabel: longDate(d.date), availableSlots: d.availableSlots })),
          };
        } catch (error) {
          return expectedError(error);
        }
      },
    }),

    findAvailableSlots: tool({
      description:
        "Find free appointment times for a service on one date (studio local time). Optionally limit to a time window.",
      inputSchema: z.object({
        serviceId: idSchema.describe("Service id from listServices"),
        date: isoDateSchema.describe("Date in YYYY-MM-DD, resolved with the calendar in your instructions"),
        from: timeSchema.optional().describe("Earliest start time, HH:MM local, inclusive"),
        to: timeSchema.optional().describe("Latest start time, HH:MM local, exclusive"),
      }),
      execute: async ({ serviceId, date, from, to }) => {
        if (overLimit()) return limitReached;
        const invalid = checkDate(date);
        if (invalid) return { status: "invalid_date" as const, message: invalid };
        try {
          const slots = (await capability.findAvailableSlots(serviceId, date)).filter((slot) => {
            const time = wallTime(slot.startsAtLocal);
            return (!from || time >= from) && (!to || time < to);
          });
          const base = { date, dateLabel: longDate(date), weekday: weekdayOf(date), timeZone, from, to };
          if (slots.length === 0) {
            const upcoming = await capability.findAvailableDates(serviceId, 14);
            return {
              status: "no_availability" as const,
              ...base,
              otherDaysWithAvailability: upcoming
                .filter((d) => d.availableSlots > 0 && d.date !== date)
                .slice(0, 5)
                .map((d) => ({ date: d.date, dateLabel: longDate(d.date), availableSlots: d.availableSlots })),
            };
          }
          return {
            status: "ok" as const,
            ...base,
            slots: slots.map((slot) => ({
              slotId: slot.id,
              startTime: wallTime(slot.startsAtLocal),
              endTime: wallTime(slot.endsAtLocal),
              startsAtUtc: slot.startsAt,
              providerName: slot.providerName,
              providerTimezone: slot.providerTimezone,
            })),
          };
        } catch (error) {
          return expectedError(error);
        }
      },
    }),

    createBooking: tool({
      description:
        "Book a slot for the guest. The guest must then approve the booking in the app before it is made. Requires a slotId from findAvailableSlots and the guest's name.",
      inputSchema: z.object({
        slotId: idSchema.describe("slotId from findAvailableSlots"),
        guestName: guestNameSchema.describe("The guest's name as they gave it"),
        review: bookingReviewSchema.optional().describe("Leave this out. The server fills it in."),
      }),
      execute: async ({ slotId, guestName }, { toolCallId }): Promise<CreateBookingOutput> => {
        if (overLimit()) return limitReached;
        // Derived from the signed tool call id: never from model output.
        const idempotencyKey = bookingIdempotencyKey(secret, toolCallId);
        try {
          const result = await capability.createBooking(slotId, guestName, idempotencyKey);
          const access = sealBookingAccess(secret, {
            bookingId: result.booking.id,
            managementToken: result.managementToken,
          });
          accessible.push(access);
          return { status: "confirmed", booking: toConfirmed(result.booking), access };
        } catch (error) {
          if (error instanceof BookingError) {
            switch (error.code) {
              case "SLOT_ALREADY_BOOKED":
              case "SLOT_UNAVAILABLE":
                return {
                  status: "slot_unavailable",
                  message: "This time is no longer available; someone else booked it first. Nothing was booked.",
                };
              case "SLOT_NOT_FOUND":
                return { status: "slot_not_found", message: "That slot does not exist. Nothing was booked." };
              case "INVALID_INPUT":
                return { status: "invalid_input", message: describeIssues(error) };
            }
          }
          throw error;
        }
      },
      // The model sees the outcome, never the sealed credential.
      toModelOutput: ({ output }) => {
        if (output.status !== "confirmed") return { type: "json", value: output };
        return { type: "json", value: { status: output.status, booking: output.booking } };
      },
    }),

    getBooking: tool({
      description:
        "Look up a booking made earlier in this conversation by its reference. Other bookings cannot be accessed.",
      inputSchema: z.object({
        reference: z
          .string()
          .regex(/^[A-Za-z0-9]{8}$/, { message: "Must be an 8-character booking reference" })
          .describe("Booking reference, e.g. 3F9A12BC"),
      }),
      execute: async ({ reference }) => {
        if (overLimit()) return limitReached;
        const wanted = reference.toUpperCase();
        for (const sealed of accessible) {
          const access = openBookingAccess(secret, sealed);
          if (!access || bookingReference(access.bookingId) !== wanted) continue;
          try {
            const booking = await capability.getBooking(access.bookingId, access.managementToken);
            return { status: "found" as const, booking: toConfirmed(booking) };
          } catch (error) {
            if (error instanceof BookingError && error.code === "BOOKING_ACCESS_DENIED") break;
            throw error;
          }
        }
        return {
          status: "not_available" as const,
          message: "I can only look up bookings made in this conversation.",
        };
      },
    }),

    listMyBookings: tool({
      description:
        "List the bookings made earlier in this conversation, with their current status. Other bookings cannot be accessed.",
      inputSchema: z.object({}),
      execute: async () => {
        if (overLimit()) return limitReached;
        const bookings: ConfirmedBooking[] = [];
        const seen = new Set<string>();
        for (const sealed of accessible) {
          const access = openBookingAccess(secret, sealed);
          if (!access || seen.has(access.bookingId)) continue;
          seen.add(access.bookingId);
          try {
            bookings.push(toConfirmed(await capability.getBooking(access.bookingId, access.managementToken)));
          } catch (error) {
            // A credential that no longer opens its booking is simply skipped.
            if (!(error instanceof BookingError && error.code === "BOOKING_ACCESS_DENIED")) throw error;
          }
        }
        if (bookings.length === 0) {
          return { status: "none" as const, message: "No bookings have been made in this conversation yet." };
        }
        return { status: "ok" as const, bookings };
      },
    }),
  };

  /**
   * Binds the approval to server-validated booking details: whatever the model
   * put in `review` is replaced with the slot's real service, provider, date and
   * time. The refined input is what the guest approves and what the approval
   * signature covers; it is recomputed and compared when the approval returns.
   */
  const refineToolInput: ToolInputRefinement<typeof tools> = {
    createBooking: async (input) => {
      const slot = await capability.getSlot(input.slotId);
      const date = wallDate(slot.startsAtLocal);
      return {
        slotId: input.slotId,
        guestName: input.guestName,
        review: {
          serviceName: slot.serviceName,
          providerName: slot.providerName,
          date,
          dateLabel: longDate(date),
          startTime: wallTime(slot.startsAtLocal),
          endTime: wallTime(slot.endsAtLocal),
          timeZone: slot.providerTimezone,
        },
      };
    },
  };

  /**
   * createBooking always needs explicit approval from the guest. A slot that is
   * already gone is denied up front instead of asking for approval. When an
   * approval comes back, availability is left to the database (which also
   * recognises an idempotent retry of a booking this approval already made).
   */
  const toolApproval: ToolApprovalConfiguration<typeof tools, Record<string, unknown>> = {
    createBooking: async (input, { toolCallId, messages }) => {
      if (isReturningApproval(messages, toolCallId)) return "user-approval";
      const slot = await capability.getSlot(input.slotId);
      if (!slot.available) {
        return { type: "denied", reason: "That time is no longer available. Nothing was booked." };
      }
      return { type: "user-approval", reason: "Please confirm this booking." };
    },
  };

  return { tools, refineToolInput, toolApproval };
}

export type BookingTools = ReturnType<typeof createBookingTools>["tools"];

/** True when `messages` already contain the approval request for this tool call. */
function isReturningApproval(messages: ModelMessage[], toolCallId: string): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "tool-approval-request" && part.toolCallId === toolCallId),
  );
}

function expectedError(error: unknown) {
  if (error instanceof BookingError) {
    if (error.code === "SERVICE_NOT_FOUND") {
      return { status: "service_not_found" as const, message: "Unknown service. Use a serviceId from listServices." };
    }
    if (error.code === "INVALID_INPUT") {
      return { status: "invalid_input" as const, message: describeIssues(error) };
    }
  }
  throw error;
}

function describeIssues(error: BookingError): string {
  return (error.details ?? []).map((d) => `${d.path}: ${d.message}`).join("; ") || error.message;
}
