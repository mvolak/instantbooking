"use client";

import { CalendarX2 } from "lucide-react";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { guestNameSchema } from "@/schemas/booking";
import {
  createBookingClient,
  newIdempotencyKey,
  SLOT_GONE_CODES,
  type ApiError,
  type BookingClient,
} from "@/lib/booking-client";
import { AvailableSlots, SlotsSkeleton } from "./AvailableSlots";
import { BookingConfirmation } from "./BookingConfirmation";
import { attemptFor, bookingFlowReducer, initialBookingFlowState } from "./booking-flow";
import { DateSelector } from "./DateSelector";
import { ErrorMessage, Notice, StepHeading } from "./feedback";
import { formatDate, formatTime } from "./format";
import { GuestDetails } from "./GuestDetails";
import { ServiceCard } from "./ServiceCard";

/** How many upcoming days the date selector offers. */
export const BOOKING_WINDOW_DAYS = 14;

type Props = {
  /** Injected for tests or alternative transports; defaults to the same-origin REST API. */
  client?: BookingClient;
  /** Idempotency key generator; injectable for tests. */
  generateKey?: () => string;
};

export function BookingWidget({ client: injectedClient, generateKey = newIdempotencyKey }: Props) {
  const [client] = useState(() => injectedClient ?? createBookingClient());
  const [state, dispatch] = useReducer(bookingFlowReducer, initialBookingFlowState);
  // Synchronous guard against double submission (state updates are async).
  const submitting = useRef(false);

  const { serviceId, date, servicesRequest, availabilityRequest } = state;

  useEffect(() => {
    const controller = new AbortController();
    client
      .listServices(controller.signal)
      .then((r) => dispatch(r.ok ? { type: "services/loaded", services: r.data } : { type: "services/failed", error: r.error }))
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [client, servicesRequest]);

  useEffect(() => {
    if (!serviceId) return;
    const controller = new AbortController();
    client
      .findAvailableDates(serviceId, BOOKING_WINDOW_DAYS, controller.signal)
      .then((r) =>
        dispatch(
          r.ok ? { type: "dates/loaded", serviceId, dates: r.data } : { type: "dates/failed", serviceId, error: r.error },
        ),
      )
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [client, serviceId, availabilityRequest]);

  useEffect(() => {
    if (!serviceId || !date) return;
    // Aborting on change means a slow response for an earlier date can never
    // overwrite the current one (the reducer also ignores mismatched dates).
    const controller = new AbortController();
    client
      .findAvailableSlots(serviceId, date, controller.signal)
      .then((r) =>
        dispatch(r.ok ? { type: "slots/loaded", date, slots: r.data } : { type: "slots/failed", date, error: r.error }),
      )
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [client, serviceId, date, availabilityRequest]);

  const selectedSlot =
    state.slots?.status === "ready" ? (state.slots.data.find((s) => s.id === state.slotId) ?? null) : null;
  const selection = selectedSlot && date ? `${formatDate(date, "medium")} at ${formatTime(selectedSlot.startsAtLocal)}` : null;

  async function submit() {
    if (submitting.current || !selectedSlot) return;

    const name = guestNameSchema.safeParse(state.guestName);
    if (!name.success) {
      dispatch({ type: "submit/invalid", message: name.error.issues[0]?.message ?? "Please enter your name" });
      return;
    }

    const attempt = attemptFor(state.attempt, selectedSlot.id, name.data, generateKey);
    submitting.current = true;
    dispatch({ type: "submit/started", attempt });
    try {
      const result = await client.createBooking({ slotId: attempt.slotId, guestName: attempt.guestName }, attempt.key);
      if (result.ok) {
        // The management token is deliberately not kept: M2 has no use for it,
        // and it must never reach URLs, logs or browser storage.
        dispatch({ type: "submit/succeeded", booking: result.data.booking });
      } else if (SLOT_GONE_CODES.includes(result.error.code)) {
        dispatch({ type: "submit/slotGone", message: slotGoneMessage(result.error) });
      } else if (result.error.code === "INVALID_INPUT" && result.error.details?.some((d) => d.path === "guestName")) {
        dispatch({ type: "submit/invalid", message: result.error.details.find((d) => d.path === "guestName")!.message });
      } else {
        dispatch({ type: "submit/failed", error: result.error });
      }
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section
      aria-labelledby="booking-title"
      className="rounded-3xl border border-sand-200 bg-white/80 p-5 shadow-[0_24px_60px_-28px_rgba(27,38,34,0.35)] backdrop-blur sm:p-7"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 id="booking-title" className="font-display text-xl font-semibold text-ink sm:text-2xl">
          Book an appointment
        </h2>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sage-50 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-sage-800">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-sage-500" />
          Live availability
        </span>
      </div>

      {state.confirmed ? (
        <BookingConfirmation booking={state.confirmed} onBookAnother={() => dispatch({ type: "reset" })} />
      ) : (
        <div className="space-y-7">
          {/* Step 1 — service */}
          <div className="space-y-3">
            <StepHeading step={1} id="step-service">
              Service
            </StepHeading>
            {state.services.status === "loading" && <LoadingBlock label="Loading services…" className="h-24" />}
            {state.services.status === "error" && (
              <ErrorMessage onRetry={() => dispatch({ type: "services/retry" })}>
                {errorText(state.services.error, "We couldn’t load our services.")}
              </ErrorMessage>
            )}
            {state.services.status === "ready" &&
              (state.services.data.length === 0 ? (
                <p className="text-sm text-ink-muted">No services are open for booking right now.</p>
              ) : state.services.data.length === 1 ? (
                <ServiceCard service={state.services.data[0]} />
              ) : (
                <div role="group" aria-labelledby="step-service" className="space-y-2">
                  {state.services.data.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      selected={service.id === serviceId}
                      onSelect={(id) => dispatch({ type: "service/selected", serviceId: id })}
                    />
                  ))}
                </div>
              ))}
          </div>

          {/* Step 2 — date */}
          {state.dates && (
            <div className="space-y-3">
              <StepHeading step={2} id="step-date">
                Date
              </StepHeading>
              {state.dates.status === "loading" && <LoadingBlock label="Loading available dates…" className="h-[92px]" />}
              {state.dates.status === "error" && (
                <ErrorMessage onRetry={() => dispatch({ type: "availability/refresh" })}>
                  {errorText(state.dates.error, "We couldn’t load available dates.")}
                </ErrorMessage>
              )}
              {state.dates.status === "ready" &&
                (state.dates.data.every((d) => d.availableSlots === 0) ? (
                  <EmptyState>
                    No free appointments in the next {BOOKING_WINDOW_DAYS} days. Please check back soon.
                  </EmptyState>
                ) : (
                  <DateSelector
                    dates={state.dates.data}
                    selected={date}
                    onSelect={(d) => dispatch({ type: "date/selected", date: d })}
                    labelledBy="step-date"
                  />
                ))}
            </div>
          )}

          {/* Step 3 — time */}
          {state.slots && date && (
            <div className="space-y-3">
              <StepHeading step={3} id="step-time">
                Time <span className="font-normal text-ink-muted">· {formatDate(date, "medium")}</span>
              </StepHeading>
              {state.notice && <Notice>{state.notice}</Notice>}
              {state.slots.status === "loading" && (
                <div aria-busy="true">
                  <span role="status" className="sr-only">
                    Loading available times…
                  </span>
                  <SlotsSkeleton />
                </div>
              )}
              {state.slots.status === "error" && (
                <ErrorMessage onRetry={() => dispatch({ type: "availability/refresh" })}>
                  {errorText(state.slots.error, "We couldn’t load available times.")}
                </ErrorMessage>
              )}
              {state.slots.status === "ready" &&
                (state.slots.data.length === 0 ? (
                  <EmptyState>No times left on this day. Please choose another date.</EmptyState>
                ) : (
                  <AvailableSlots
                    slots={state.slots.data}
                    selected={state.slotId}
                    onSelect={(slotId) => dispatch({ type: "slot/selected", slotId })}
                    labelledBy="step-time"
                  />
                ))}
            </div>
          )}
          {!date && state.notice && <Notice>{state.notice}</Notice>}

          {/* Step 4 — guest details and booking */}
          {state.services.status === "ready" && state.services.data.length > 0 && (
            <div className="space-y-3">
              <StepHeading step={4} id="step-details">
                Your details
              </StepHeading>
              <GuestDetails
                name={state.guestName}
                error={state.nameError}
                onNameChange={(value) => dispatch({ type: "guestName/changed", value })}
                onSubmit={submit}
                submitting={state.submit.status === "submitting"}
                selection={selection}
                labelledBy="step-details"
              />
              {state.submit.status === "failed" && (
                <ErrorMessage>{errorText(state.submit.error, "Your booking could not be completed.")}</ErrorMessage>
              )}
              <p className="text-xs text-ink-muted">No account or payment needed. You&rsquo;ll get a confirmation right here.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LoadingBlock({ label, className }: { label: string; className: string }) {
  return (
    <div aria-busy="true" className={`animate-pulse rounded-2xl bg-sand-100 ${className}`}>
      <span role="status" className="sr-only">
        {label}
      </span>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-sand-300 p-4 text-sm text-ink-muted">
      <CalendarX2 aria-hidden className="size-5 shrink-0 text-sand-300" />
      <p>{children}</p>
    </div>
  );
}

function errorText(error: ApiError, context: string): string {
  if (error.code === "NETWORK_ERROR") {
    return `${context} Please check your connection and try again — you won’t be booked twice.`;
  }
  if (error.status >= 500 || error.code === "INTERNAL_ERROR") {
    return `${context} Something went wrong on our side. Please try again.`;
  }
  return `${context} ${error.message}.`.replace("..", ".");
}

function slotGoneMessage(error: ApiError): string {
  return error.code === "SLOT_ALREADY_BOOKED"
    ? "Sorry — that time was just booked by someone else. Here are the times still available."
    : "Sorry — that time is no longer available. Here are the times still available.";
}

function ignoreAbort(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return;
  throw error;
}
