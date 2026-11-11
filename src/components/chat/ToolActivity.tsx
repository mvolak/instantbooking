"use client";

import { CalendarSearch, ListChecks, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { Spinner } from "@/components/booking/feedback";
import { pluralize } from "@/components/booking/format";

type Part = BookingUIMessage["parts"][number];
export type LookupPart = Extract<
  Part,
  {
    type:
      | "tool-listServices"
      | "tool-findAvailableDates"
      | "tool-findAvailableSlots"
      | "tool-getBooking"
      | "tool-listMyBookings";
  }
>;

/**
 * Compact status line for read-only tool calls. When the reply has no usable
 * generated UI, the times found are also listed here as a deterministic
 * fallback so the guest can still pick one with a click.
 */
export function ToolActivity({ part, onPickTime, disabled, showTimes }: {
  part: LookupPart;
  onPickTime: (text: string, slotId: string) => void;
  disabled: boolean;
  /** Show the fallback time buttons for availability results. */
  showTimes: boolean;
}) {
  const running = part.state === "input-streaming" || part.state === "input-available";
  if (part.state === "output-error") {
    return <Line icon={<Search aria-hidden className="size-3.5" />}>A lookup failed.</Line>;
  }

  switch (part.type) {
    case "tool-listServices":
      return (
        <Line icon={running ? <Spinner className="size-3.5" /> : <ListChecks aria-hidden className="size-3.5" />}>
          {running ? "Looking up services…" : "Checked our services"}
        </Line>
      );
    case "tool-findAvailableDates":
      return (
        <Line icon={running ? <Spinner className="size-3.5" /> : <CalendarSearch aria-hidden className="size-3.5" />}>
          {running ? "Checking upcoming days…" : "Checked upcoming days"}
        </Line>
      );
    case "tool-getBooking":
      return (
        <Line icon={running ? <Spinner className="size-3.5" /> : <Search aria-hidden className="size-3.5" />}>
          {running ? "Looking up your booking…" : "Looked up your booking"}
        </Line>
      );
    case "tool-listMyBookings": {
      // The outcome is stated here deterministically, whatever UI the model adds.
      const found =
        part.state !== "output-available"
          ? null
          : part.output.status === "ok"
            ? `Found ${pluralize(part.output.bookings.length, "booking", "bookings")} in this conversation`
            : part.output.status === "none"
              ? "No bookings in this conversation yet"
              : "Looked up your bookings";
      return (
        <Line icon={running ? <Spinner className="size-3.5" /> : <Search aria-hidden className="size-3.5" />}>
          {running ? "Looking up your bookings…" : (found ?? "Looked up your bookings")}
        </Line>
      );
    }
    case "tool-findAvailableSlots": {
      if (part.state !== "output-available") {
        return (
          <Line icon={running ? <Spinner className="size-3.5" /> : <CalendarSearch aria-hidden className="size-3.5" />}>
            Checking availability…
          </Line>
        );
      }
      const output = part.output;
      if (output.status !== "ok") {
        const label = "dateLabel" in output ? output.dateLabel : "that date";
        return (
          <Line icon={<CalendarSearch aria-hidden className="size-3.5" />}>
            {output.status === "no_availability" ? `No free times on ${label}` : "Checked availability"}
          </Line>
        );
      }
      if (!showTimes) {
        return (
          <Line icon={<CalendarSearch aria-hidden className="size-3.5" />}>Checked times on {output.dateLabel}</Line>
        );
      }
      return (
        <div className="space-y-2">
          <Line icon={<CalendarSearch aria-hidden className="size-3.5" />}>
            Free times on {output.dateLabel}
          </Line>
          <ul aria-label={`Free times on ${output.dateLabel}`} className="flex flex-wrap gap-1.5">
            {output.slots.map((slot) => (
              <li key={slot.slotId}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPickTime(`I'd like the ${slot.startTime} appointment on ${output.dateLabel}.`, slot.slotId)}
                  className="min-h-9 rounded-lg border border-sand-300 bg-white px-2.5 text-sm font-medium tabular-nums text-ink transition hover:border-sage-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {slot.startTime}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-muted">
      {icon}
      {children}
    </p>
  );
}
