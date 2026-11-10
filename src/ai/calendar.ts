/**
 * Calendar helpers for interpreting dates in the studio's timezone. Dates are
 * plain `YYYY-MM-DD` strings; arithmetic happens on UTC noon so DST never
 * shifts a calendar day.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function parts(instant: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return values as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

/** The calendar date at `instant` in `timeZone`, as `YYYY-MM-DD`. */
export function localDate(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The wall-clock time at `instant` in `timeZone`, as `HH:MM`. */
export function localTime(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.hour}:${p.minute}`;
}

const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`);

export function addDays(date: string, days: number): string {
  const d = noonUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((noonUtc(to).getTime() - noonUtc(from).getTime()) / 86_400_000);
}

export function weekdayOf(date: string): string {
  return WEEKDAYS[noonUtc(date).getUTCDay()];
}

/** `2026-11-12` → `Thursday 12 November 2026`. */
export function longDate(date: string): string {
  const d = noonUtc(date);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `2026-11-12T16:30:00+01:00` → `16:30` (the wall-clock time of a local ISO timestamp). */
export const wallTime = (localIso: string) => localIso.slice(11, 16);

/** `2026-11-12T16:30:00+01:00` → `2026-11-12`. */
export const wallDate = (localIso: string) => localIso.slice(0, 10);
