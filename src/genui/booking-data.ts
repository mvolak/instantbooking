import type { BookingUIMessage } from "@/ai/booking-agent";
import type { ConfirmedBooking } from "@/ai/booking-tools";

/**
 * The authoritative data generated UI may display: everything here comes from
 * booking tool results in the conversation, never from model-written props.
 * Generated components hold references (date, slot id, booking reference) and
 * resolve them against this index; an unknown reference renders nothing.
 */

export type SlotView = {
  slotId: string;
  serviceId: string;
  date: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  providerName: string;
  timeZone: string;
};

export type DayView = { date: string; dateLabel: string; availableSlots: number };

export type ServiceView = { serviceId: string; name: string; description: string | null; durationMinutes: number };

export type BookingData = {
  slots: ReadonlyMap<string, SlotView>;
  /** Latest known free times per date (a newer lookup replaces an older one). */
  slotsByDate: ReadonlyMap<string, readonly SlotView[]>;
  /** Days from the latest findAvailableDates result. */
  days: readonly DayView[];
  services: ReadonlyMap<string, ServiceView>;
  /** Bookings made in this conversation, by reference, with their latest known status. */
  bookings: ReadonlyMap<string, ConfirmedBooking>;
  /** Slots the guest has already picked in generated UI. */
  selectedSlotIds: ReadonlySet<string>;
};

export function collectBookingData(messages: readonly BookingUIMessage[]): BookingData {
  const slots = new Map<string, SlotView>();
  const slotsByDate = new Map<string, SlotView[]>();
  const services = new Map<string, ServiceView>();
  const bookings = new Map<string, ConfirmedBooking>();
  const selectedSlotIds = new Set<string>();
  let days: DayView[] = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-slotSelection") {
        selectedSlotIds.add(part.data.slotId);
        continue;
      }
      if (!("state" in part) || part.state !== "output-available") continue;

      switch (part.type) {
        case "tool-listServices":
          if (part.output.status === "ok") {
            for (const service of part.output.services) services.set(service.serviceId, service);
          }
          break;
        case "tool-findAvailableDates":
          if (part.output.status === "ok") days = part.output.days;
          break;
        case "tool-findAvailableSlots": {
          const output = part.output;
          if (output.status !== "ok" && output.status !== "no_availability") break;
          const found = (output.status === "ok" ? output.slots : []).map(
            (slot): SlotView => ({
              slotId: slot.slotId,
              serviceId: part.input.serviceId,
              date: output.date,
              dateLabel: output.dateLabel,
              startTime: slot.startTime,
              endTime: slot.endTime,
              providerName: slot.providerName,
              timeZone: slot.providerTimezone,
            }),
          );
          for (const slot of found) slots.set(slot.slotId, slot);
          // A filtered lookup (from/to) only replaces the times inside its window.
          const { from, to } = part.input;
          const outside = (slotsByDate.get(output.date) ?? []).filter(
            (slot) => (from !== undefined && slot.startTime < from) || (to !== undefined && slot.startTime >= to),
          );
          slotsByDate.set(
            output.date,
            [...outside, ...found].sort((a, b) => a.startTime.localeCompare(b.startTime)),
          );
          break;
        }
        case "tool-createBooking": {
          if (part.output.status === "confirmed") bookings.set(part.output.booking.reference, part.output.booking);
          // Booked (by this guest or someone else): no longer offered as free.
          if (part.output.status === "confirmed" || part.output.status === "slot_unavailable") {
            const taken = part.input.slotId;
            for (const [date, list] of slotsByDate) slotsByDate.set(date, list.filter((s) => s.slotId !== taken));
            slots.delete(taken);
          }
          break;
        }
        case "tool-getBooking":
          if (part.output.status === "found") bookings.set(part.output.booking.reference, part.output.booking);
          break;
        case "tool-listMyBookings":
          if (part.output.status === "ok") {
            for (const booking of part.output.bookings) bookings.set(booking.reference, booking);
          }
          break;
      }
    }
  }

  return { slots, slotsByDate, days, services, bookings, selectedSlotIds };
}
