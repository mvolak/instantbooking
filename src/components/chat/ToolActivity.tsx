"use client";

import { CalendarSearch, ListChecks, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { Spinner } from "@/components/booking/feedback";

type Part = BookingUIMessage["parts"][number];
export type LookupPart = Extract<
  Part,
  { type: "tool-listServices" | "tool-findAvailableDates" | "tool-findAvailableSlots" | "tool-getBooking" }
>;

/**
 * Compact status line for read-only tool calls, plus the times found so the
 * guest can pick one with a click.
 */
export function ToolActivity({ part, onPickTime, disabled }: {
  part: LookupPart;
  onPickTime: (text: string) => void;
  disabled: boolean;
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
                  onClick={() => onPickTime(`I'd like the ${slot.startTime} appointment on ${output.dateLabel}.`)}
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
