"use client";

import { CalendarCheck, CircleCheck, CircleX } from "lucide-react";
import { useState } from "react";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { ErrorMessage, Notice, Spinner } from "@/components/booking/feedback";
import { timezoneCity } from "@/components/booking/format";

export type CreateBookingPart = Extract<BookingUIMessage["parts"][number], { type: "tool-createBooking" }>;

type Props = {
  part: CreateBookingPart;
  /** Sends the guest's decision for this approval request. */
  onRespond: (approvalId: string, approved: boolean) => void;
  /** True while the chat is busy; decisions are not accepted then. */
  disabled: boolean;
};

/**
 * Renders one createBooking tool call through its lifecycle: the review card
 * with explicit Confirm / Cancel controls, progress, and the authoritative
 * result. Every detail shown comes from the server, not from model text.
 */
export function BookingApproval({ part, onRespond, disabled }: Props) {
  const [decided, setDecided] = useState(false);
  const review = completeReview(part.input?.review);

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return <Progress>Preparing your booking…</Progress>;

    case "approval-requested": {
      if (part.approval.isAutomatic) return <Progress>Checking the slot…</Progress>;
      if (!review) return <ErrorMessage>We couldn’t load the booking details. Nothing was booked.</ErrorMessage>;
      const respond = (approved: boolean) => {
        if (decided || disabled) return;
        setDecided(true);
        onRespond(part.approval.id, approved);
      };
      return (
        <section
          aria-labelledby={`review-${part.toolCallId}`}
          data-testid="booking-review"
          className="rounded-2xl border border-sage-300 bg-white p-4 shadow-sm"
        >
          <h4 id={`review-${part.toolCallId}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarCheck aria-hidden className="size-4 text-sage-700" />
            Please confirm your booking
          </h4>
          <Details
            rows={[
              ["Service", review.serviceName],
              ["Date", review.dateLabel],
              ["Time", `${review.startTime}–${review.endTime} (${timezoneCity(review.timeZone)} time)`],
              ["With", review.providerName],
              ["Name", part.input.guestName],
            ]}
          />
          <p className="mt-3 text-xs text-ink-muted">Nothing is booked until you confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => respond(true)}
              disabled={decided || disabled}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl sm:flex-none bg-sage-700 px-4 text-sm font-semibold text-white transition hover:bg-sage-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CircleCheck aria-hidden className="size-4" />
              Confirm booking
            </button>
            <button
              type="button"
              onClick={() => respond(false)}
              disabled={decided || disabled}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl sm:flex-none border border-sand-300 bg-white px-4 text-sm font-semibold text-ink transition hover:border-sage-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CircleX aria-hidden className="size-4" />
              Cancel
            </button>
          </div>
        </section>
      );
    }

    case "approval-responded":
      return part.approval.approved ? (
        <Progress>Booking your appointment…</Progress>
      ) : (
        <Notice>Booking cancelled. Nothing was booked.</Notice>
      );

    case "output-denied":
      return (
        <Notice>
          {part.approval.isAutomatic && part.approval.reason
            ? part.approval.reason
            : "Booking cancelled. Nothing was booked."}
        </Notice>
      );

    case "output-error":
      return <ErrorMessage>We couldn’t complete this booking. Nothing was confirmed.</ErrorMessage>;

    case "output-available": {
      const output = part.output;
      if (output.status !== "confirmed") return <Notice>{output.message}</Notice>;
      const booking = output.booking;
      return (
        <section
          role="status"
          aria-label="Booking confirmed"
          data-testid="chat-booking-confirmation"
          className="rounded-2xl border border-sage-300 bg-sage-50 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-sage-800">
            <CircleCheck aria-hidden className="size-4" />
            You’re booked!
          </p>
          <Details
            rows={[
              ["Reference", booking.reference],
              ["Service", booking.serviceName],
              ["Date", booking.dateLabel],
              ["Time", `${booking.startTime}–${booking.endTime} (${timezoneCity(booking.timeZone)} time)`],
              ["With", booking.providerName],
              ["Name", booking.guestName],
              ["Status", booking.status === "confirmed" ? "Confirmed" : booking.status],
            ]}
          />
        </section>
      );
    }
  }
}

type Review = Record<"serviceName" | "providerName" | "dateLabel" | "startTime" | "endTime" | "timeZone", string>;

/** The server-filled review, only if every field is present. */
function completeReview(review: Partial<Record<keyof Review, string | undefined>> | undefined): Review | null {
  if (!review) return null;
  const { serviceName, providerName, dateLabel, startTime, endTime, timeZone } = review;
  if (!serviceName || !providerName || !dateLabel || !startTime || !endTime || !timeZone) return null;
  return { serviceName, providerName, dateLabel, startTime, endTime, timeZone };
}

function Details({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-3 divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-3 py-2">
          <dt className="text-ink-muted">{label}</dt>
          <dd
            className={`text-right font-medium break-words text-ink ${label === "Reference" ? "font-mono tracking-wider" : ""}`}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Progress({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <Spinner />
      {children}
    </p>
  );
}
