/**
 * Pure state machine for the booking widget. All transitions live here so the
 * UI stays predictable and the flow can be reasoned about (and tested) without
 * rendering anything.
 */
import type { AvailableDate, AvailableSlot, Booking, Service } from "@/domain/booking";
import type { ApiError } from "@/lib/booking-client";

export type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiError };

/** An idempotency key bound to one (slot, guest name) booking attempt. */
export type BookingAttempt = { key: string; slotId: string; guestName: string };

export type BookingFlowState = {
  services: Loadable<Service[]>;
  serviceId: string | null;
  dates: Loadable<AvailableDate[]> | null;
  date: string | null;
  slots: Loadable<AvailableSlot[]> | null;
  slotId: string | null;
  guestName: string;
  nameError: string | null;
  submit: { status: "idle" } | { status: "submitting" } | { status: "failed"; error: ApiError };
  /** Kept after a failed submission so a retry reuses the same idempotency key. */
  attempt: BookingAttempt | null;
  /** Informational message, e.g. "that time was just taken". */
  notice: string | null;
  confirmed: Booking | null;
  /** Incremented to (re)load services. */
  servicesRequest: number;
  /** Incremented to reload dates and slots for the current selection. */
  availabilityRequest: number;
};

export type BookingFlowAction =
  | { type: "services/loaded"; services: Service[] }
  | { type: "services/failed"; error: ApiError }
  | { type: "services/retry" }
  | { type: "service/selected"; serviceId: string }
  | { type: "dates/loaded"; serviceId: string; dates: AvailableDate[] }
  | { type: "dates/failed"; serviceId: string; error: ApiError }
  | { type: "date/selected"; date: string }
  | { type: "slots/loaded"; date: string; slots: AvailableSlot[] }
  | { type: "slots/failed"; date: string; error: ApiError }
  | { type: "availability/refresh" }
  | { type: "slot/selected"; slotId: string }
  | { type: "guestName/changed"; value: string }
  | { type: "submit/invalid"; message: string }
  | { type: "submit/started"; attempt: BookingAttempt }
  | { type: "submit/succeeded"; booking: Booking }
  | { type: "submit/slotGone"; message: string }
  | { type: "submit/failed"; error: ApiError }
  | { type: "reset" };

export const initialBookingFlowState: BookingFlowState = {
  services: { status: "loading" },
  serviceId: null,
  dates: null,
  date: null,
  slots: null,
  slotId: null,
  guestName: "",
  nameError: null,
  submit: { status: "idle" },
  attempt: null,
  notice: null,
  confirmed: null,
  servicesRequest: 0,
  availabilityRequest: 0,
};

export function bookingFlowReducer(state: BookingFlowState, action: BookingFlowAction): BookingFlowState {
  switch (action.type) {
    case "services/loaded": {
      const keep = action.services.some((s) => s.id === state.serviceId);
      const serviceId = keep ? state.serviceId : (action.services[0]?.id ?? null);
      return selectService({ ...state, services: { status: "ready", data: action.services } }, serviceId);
    }
    case "services/failed":
      return { ...state, services: { status: "error", error: action.error } };
    case "services/retry":
      return { ...state, services: { status: "loading" }, servicesRequest: state.servicesRequest + 1 };

    case "service/selected":
      return action.serviceId === state.serviceId ? state : selectService(state, action.serviceId);

    case "dates/loaded": {
      if (action.serviceId !== state.serviceId) return state; // stale response
      // Keep the current date if it is still bookable, otherwise jump to the next day with availability.
      const current = action.dates.find((d) => d.date === state.date && d.availableSlots > 0);
      const date = current?.date ?? action.dates.find((d) => d.availableSlots > 0)?.date ?? null;
      return {
        ...state,
        dates: { status: "ready", data: action.dates },
        date,
        slots: date ? (date === state.date && state.slots ? state.slots : { status: "loading" }) : null,
        slotId: date === state.date ? state.slotId : null,
      };
    }
    case "dates/failed":
      if (action.serviceId !== state.serviceId) return state;
      return { ...state, dates: { status: "error", error: action.error }, date: null, slots: null, slotId: null };

    case "date/selected":
      if (action.date === state.date) return state;
      return { ...state, date: action.date, slots: { status: "loading" }, slotId: null, notice: null };

    case "slots/loaded": {
      if (action.date !== state.date) return state; // stale response for a previously selected date
      const slotStillFree = action.slots.some((s) => s.id === state.slotId);
      return { ...state, slots: { status: "ready", data: action.slots }, slotId: slotStillFree ? state.slotId : null };
    }
    case "slots/failed":
      if (action.date !== state.date) return state;
      return { ...state, slots: { status: "error", error: action.error } };

    case "availability/refresh":
      return {
        ...state,
        dates: state.serviceId ? { status: "loading" } : null,
        slots: state.date ? { status: "loading" } : null,
        availabilityRequest: state.availabilityRequest + 1,
      };

    case "slot/selected":
      return { ...state, slotId: action.slotId, notice: null, submit: { status: "idle" } };

    case "guestName/changed":
      return { ...state, guestName: action.value, nameError: null };

    case "submit/invalid":
      return { ...state, nameError: action.message, submit: { status: "idle" } };

    case "submit/started":
      return { ...state, attempt: action.attempt, submit: { status: "submitting" }, nameError: null, notice: null };

    case "submit/succeeded":
      return {
        ...state,
        confirmed: action.booking,
        attempt: null,
        submit: { status: "idle" },
        slotId: null,
      };

    case "submit/slotGone":
      // The slot is no longer bookable: drop it and the attempt, keep the name, reload availability.
      return bookingFlowReducer(
        { ...state, slotId: null, attempt: null, submit: { status: "idle" }, notice: action.message },
        { type: "availability/refresh" },
      );

    case "submit/failed":
      return {
        ...state,
        submit: { status: "failed", error: action.error },
        // A key the server rejected must not be reused; anything else may be retried safely with it.
        attempt: action.error.code === "IDEMPOTENCY_KEY_REUSED" ? null : state.attempt,
      };

    case "reset":
      return bookingFlowReducer(
        { ...state, confirmed: null, slotId: null, guestName: "", nameError: null, attempt: null, notice: null },
        { type: "availability/refresh" },
      );
  }
}

function selectService(state: BookingFlowState, serviceId: string | null): BookingFlowState {
  return {
    ...state,
    serviceId,
    dates: serviceId ? { status: "loading" } : null,
    date: null,
    slots: null,
    slotId: null,
    attempt: null,
    notice: null,
  };
}

/**
 * The idempotency key for submitting `slotId` + `guestName`: the existing
 * attempt's key when it is a retry of exactly the same request, else a new one.
 */
export function attemptFor(
  previous: BookingAttempt | null,
  slotId: string,
  guestName: string,
  newKey: () => string,
): BookingAttempt {
  if (previous && previous.slotId === slotId && previous.guestName === guestName) return previous;
  return { key: newKey(), slotId, guestName };
}
