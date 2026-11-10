"use client";

import { CalendarCheck, CircleCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Booking } from "@/domain/booking";
import { bookingReference, formatDate, formatTime, localDateOf, timezoneCity } from "./format";

type Props = {
  booking: Booking;
  onBookAnother: () => void;
};

/** Shows the booking exactly as confirmed by the server. */
export function BookingConfirmation({ booking, onBookAnother }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => headingRef.current?.focus(), []);

  const confirmed = booking.status === "confirmed";
  const rows: [string, string][] = [
    ["Reference", bookingReference(booking.id)],
    ["Service", booking.serviceName],
    ["Date", formatDate(localDateOf(booking.startsAtLocal), "long")],
    [
      "Time",
      `${formatTime(booking.startsAtLocal)}–${formatTime(booking.endsAtLocal)} (${timezoneCity(booking.providerTimezone)} time)`,
    ],
    ["With", booking.providerName],
    ["Name", booking.guestName],
  ];

  return (
    <div data-testid="booking-confirmation" className="text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-sage-100 text-sage-700">
        <CircleCheck aria-hidden className="size-8" />
      </div>
      <h3 ref={headingRef} tabIndex={-1} className="font-display mt-4 text-2xl font-semibold text-ink outline-none">
        {confirmed ? "You’re booked!" : "Booking received"}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        Status: <span className="font-medium text-sage-700">{confirmed ? "Confirmed" : booking.status}</span>
      </p>

      <dl className="mt-6 divide-y divide-sand-200 rounded-2xl border border-sand-200 bg-white text-left text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-muted">{label}</dt>
            <dd className={`text-right font-medium text-ink ${label === "Reference" ? "font-mono tracking-wider" : ""}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-xs text-ink-muted">Please note your reference and arrive a few minutes early.</p>

      <button
        type="button"
        onClick={onBookAnother}
        className="mt-6 inline-flex items-center gap-2 rounded-xl border border-sand-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-sage-400"
      >
        <CalendarCheck aria-hidden className="size-4" />
        Book another appointment
      </button>
    </div>
  );
}
