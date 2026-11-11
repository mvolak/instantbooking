"use client";

import { defineRegistry } from "@json-render/react";
import { CalendarDays, CheckCircle2, Clock, UserRound } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { longDate } from "@/ai/calendar";
import { formatDate, pluralize, timezoneCity } from "@/components/booking/format";
import type { ConfirmedBooking } from "@/ai/booking-tools";
import { bookingCatalog, type ActionName } from "./catalog";
import type { BookingData, SlotView } from "./booking-data";

/**
 * React implementations of the catalog. Layout components render the model's
 * prose; booking components render only what they resolve from
 * `BookingData` (tool results), so a generated spec can arrange real
 * appointments but never invent one.
 */

export type GenUIRuntime = {
  data: BookingData;
  /** True while the chat is busy; actions are disabled then. */
  disabled: boolean;
  /** Runs an allowlisted action through the trusted handlers. */
  run: (action: ActionName, params: Record<string, unknown>) => void;
};

export const GenUIContext = createContext<GenUIRuntime | null>(null);

function useRuntime(): GenUIRuntime {
  const runtime = useContext(GenUIContext);
  if (!runtime) throw new Error("Generated UI rendered outside GenUIContext");
  return runtime;
}

const gapClass = { sm: "gap-2", md: "gap-3", lg: "gap-4" } as const;

const buttonBase =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = `${buttonBase} bg-sage-700 text-white hover:bg-sage-800`;
const secondaryButton = `${buttonBase} border border-sand-300 bg-white text-ink hover:border-sage-400`;

export const { registry } = defineRegistry(bookingCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div
        className={`flex ${props.direction === "horizontal" ? "flex-col sm:flex-row sm:flex-wrap [&>*]:sm:min-w-56 [&>*]:sm:flex-1" : "flex-col"} ${gapClass[props.gap ?? "md"]}`}
      >
        {children}
      </div>
    ),

    Card: ({ props, children }) => (
      <section
        className={`space-y-3 rounded-2xl border p-4 ${
          props.tone === "highlight"
            ? "border-sage-300 bg-sage-50"
            : props.tone === "muted"
              ? "border-sand-200 bg-sand-50"
              : "border-sand-200 bg-white"
        }`}
      >
        {(props.title || props.description) && (
          <header className="space-y-0.5">
            {props.title && <h4 className="text-sm font-semibold text-ink">{props.title}</h4>}
            {props.description && <p className="text-sm text-ink-muted">{props.description}</p>}
          </header>
        )}
        {children}
      </section>
    ),

    Text: ({ props }) => {
      const variant = props.variant ?? "body";
      if (variant === "heading") return <p className="text-sm font-semibold text-ink">{props.text}</p>;
      if (variant === "label") {
        return <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{props.text}</p>;
      }
      return (
        <p className={`text-sm leading-relaxed break-words ${variant === "muted" ? "text-ink-muted" : "text-ink"}`}>
          {props.text}
        </p>
      );
    },

    Divider: () => <hr className="border-sand-200" />,

    ServiceSummary: ({ props }) => <ServiceSummary serviceId={props.serviceId} showDescription={props.showDescription} />,
    DayOverview: ({ props }) => <DayOverview title={props.title} limit={props.limit} />,
    SlotPicker: ({ props }) => <SlotPicker {...props} />,
    SlotOption: ({ props }) => <SlotOption slotId={props.slotId} note={props.note} />,
    BookingDetails: ({ props }) => <BookingDetails reference={props.reference} />,
    BookingList: ({ props }) => <BookingList title={props.title} references={props.references} />,

    ActionButton: ({ props, emit }) => {
      const { disabled } = useRuntime();
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => emit("press")}
          className={props.variant === "primary" ? primaryButton : secondaryButton}
        >
          {props.label}
        </button>
      );
    },
  },
  // Execution goes through the ActionProvider handlers (see GeneratedUI);
  // these registry entries only satisfy the catalog's action declarations.
  actions: {
    selectSlot: async () => {},
    showDay: async () => {},
    sendMessage: async () => {},
  },
});

function Unavailable({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-sand-300 p-3 text-sm text-ink-muted">{children}</p>;
}

function ServiceSummary({ serviceId, showDescription }: { serviceId: string; showDescription?: boolean }) {
  const service = useRuntime().data.services.get(serviceId);
  if (!service) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-ink">{service.name}</p>
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Clock aria-hidden className="size-3.5" />
        {service.durationMinutes} min
      </p>
      {showDescription && service.description && <p className="text-sm text-ink-muted">{service.description}</p>}
    </div>
  );
}

function DayOverview({ title, limit }: { title?: string; limit?: number }) {
  const { data, disabled, run } = useRuntime();
  const days = data.days.slice(0, limit ?? 7);
  if (days.length === 0) return <Unavailable>No upcoming days to show yet.</Unavailable>;
  const heading = title ?? "Upcoming availability";
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{heading}</p>
      <ul aria-label={heading} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {days.map((day) => {
          const parts = formatDate(day.date, "parts");
          const free = day.availableSlots > 0;
          return (
            <li key={day.date}>
              <button
                type="button"
                disabled={disabled || !free}
                onClick={() => run("showDay", { date: day.date })}
                aria-label={`${day.dateLabel}: ${free ? pluralize(day.availableSlots, "free time", "free times") : "fully booked"}`}
                className="flex w-full flex-col items-start rounded-xl border border-sand-200 bg-white px-3 py-2 text-left transition hover:border-sage-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-ink">
                  {parts.weekday} {parts.day} {parts.month}
                </span>
                <span className="text-xs text-ink-muted">
                  {free ? pluralize(day.availableSlots, "free time", "free times") : "Fully booked"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SlotPicker({
  date,
  from,
  to,
  title,
  layout,
  limit,
}: {
  date: string;
  from?: string;
  to?: string;
  title?: string;
  layout?: "grid" | "list";
  limit?: number;
}) {
  const { data, disabled, run } = useRuntime();
  const known = data.slotsByDate.get(date);
  if (!known) return <Unavailable>Times for this day haven’t been looked up.</Unavailable>;
  const slots = known
    .filter((slot) => (!from || slot.startTime >= from) && (!to || slot.startTime < to))
    .slice(0, limit ?? 24);
  const heading = title ?? `Free times on ${longDate(date)}`;
  if (slots.length === 0) return <Unavailable>No free times in this window.</Unavailable>;
  const timeZone = slots[0].timeZone;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{heading}</p>
      <ul
        aria-label={heading}
        className={layout === "list" ? "space-y-2" : "grid grid-cols-3 gap-2 sm:grid-cols-4"}
      >
        {slots.map((slot) => {
          const selected = data.selectedSlotIds.has(slot.slotId);
          return (
            <li key={slot.slotId}>
              <button
                type="button"
                aria-pressed={selected}
                aria-label={`Select ${slot.startTime}–${slot.endTime} on ${slot.dateLabel} with ${slot.providerName}`}
                disabled={disabled}
                onClick={() => run("selectSlot", { slotId: slot.slotId })}
                className={`w-full rounded-xl border text-sm font-medium tabular-nums transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  layout === "list" ? "flex min-h-11 items-center justify-between px-3" : "min-h-10 py-2"
                } ${
                  selected
                    ? "border-sage-700 bg-sage-700 text-white"
                    : "border-sand-200 bg-white text-ink hover:border-sage-400 hover:bg-sage-50"
                }`}
              >
                {layout === "list" ? (
                  <>
                    <span>
                      {slot.startTime}–{slot.endTime}
                    </span>
                    <span className={`text-xs ${selected ? "text-white/80" : "text-ink-muted"}`}>
                      {slot.providerName}
                    </span>
                  </>
                ) : (
                  slot.startTime
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">Times in {timezoneCity(timeZone)} time.</p>
    </div>
  );
}

function SlotOption({ slotId, note }: { slotId: string; note?: string }) {
  const { data, disabled, run } = useRuntime();
  const slot: SlotView | undefined = data.slots.get(slotId);
  if (!slot) return <Unavailable>This appointment is no longer shown as free.</Unavailable>;
  const selected = data.selectedSlotIds.has(slot.slotId);
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-sand-200 bg-white p-3">
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-ink">
          <CalendarDays aria-hidden className="size-4 text-sage-700" />
          {slot.dateLabel}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-ink">
          <Clock aria-hidden className="size-4 text-sage-700" />
          <span className="whitespace-nowrap tabular-nums">
            {slot.startTime}–{slot.endTime}
          </span>
          <span className="text-ink-muted">({timezoneCity(slot.timeZone)} time)</span>
        </p>
        <p className="flex items-center gap-1.5 text-ink-muted">
          <UserRound aria-hidden className="size-4" />
          {slot.providerName}
        </p>
        {note && <p className="text-ink-muted">{note}</p>}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Select ${slot.startTime}–${slot.endTime} on ${slot.dateLabel}`}
        disabled={disabled}
        onClick={() => run("selectSlot", { slotId: slot.slotId })}
        className={selected ? `${primaryButton} bg-sage-800` : primaryButton}
      >
        {selected && <CheckCircle2 aria-hidden className="size-4" />}
        {selected ? "Selected" : "Select"}
      </button>
    </div>
  );
}

function BookingRows({ booking }: { booking: ConfirmedBooking }) {
  const rows: [string, string][] = [
    ["Reference", booking.reference],
    ["Service", booking.serviceName],
    ["Date", booking.dateLabel],
    ["Time", `${booking.startTime}–${booking.endTime} (${timezoneCity(booking.timeZone)} time)`],
    ["With", booking.providerName],
    ["Name", booking.guestName],
  ];
  return (
    <dl className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-3 py-2">
          <dt className="text-ink-muted">{label}</dt>
          <dd className={`text-right font-medium break-words text-ink ${label === "Reference" ? "font-mono tracking-wider" : ""}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatusBadge({ status }: { status: string }) {
  const confirmed = status === "confirmed";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
        confirmed ? "bg-sage-100 text-sage-800" : "bg-sand-100 text-ink"
      }`}
    >
      {confirmed ? "Confirmed" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function BookingDetails({ reference }: { reference: string }) {
  const booking = useRuntime().data.bookings.get(reference.toUpperCase());
  if (!booking) return <Unavailable>That booking isn’t available in this conversation.</Unavailable>;
  return (
    <div className="space-y-2" aria-label={`Booking ${booking.reference}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{booking.serviceName}</p>
        <StatusBadge status={booking.status} />
      </div>
      <BookingRows booking={booking} />
    </div>
  );
}

function BookingList({ title, references }: { title?: string; references?: string[] }) {
  const { data } = useRuntime();
  const wanted = references?.map((r) => r.toUpperCase());
  const bookings = [...data.bookings.values()]
    .filter((b) => !wanted || wanted.includes(b.reference))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const heading = title ?? "Your bookings in this conversation";
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{heading}</p>
      {bookings.length === 0 ? (
        <Unavailable>No bookings in this conversation yet.</Unavailable>
      ) : (
        <ul aria-label={heading} className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
          {bookings.map((booking) => (
            <li key={booking.reference} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div>
                <p className="font-medium text-ink">
                  {formatDate(booking.date, "medium")} · <span className="tabular-nums">{booking.startTime}–{booking.endTime}</span>
                </p>
                <p className="text-xs text-ink-muted">
                  {booking.serviceName} · Ref <span className="font-mono tracking-wider">{booking.reference}</span>
                </p>
              </div>
              <StatusBadge status={booking.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
