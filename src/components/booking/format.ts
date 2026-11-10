/**
 * Display helpers. Inputs are the API's provider-local values (`YYYY-MM-DD`
 * dates and ISO 8601 times with offset), so no timezone conversion happens in
 * the browser and the visitor's own timezone never leaks into the display.
 */

const LOCALE = "en-GB";

/** Formats a provider-local calendar date (`YYYY-MM-DD`). */
export function formatDate(date: string, style: "parts"): { weekday: string; day: string; month: string };
export function formatDate(date: string, style: "long" | "medium"): string;
export function formatDate(date: string, style: "parts" | "long" | "medium") {
  // Noon UTC on that calendar date, rendered in UTC: the calendar date is preserved exactly.
  const instant = new Date(`${date}T12:00:00Z`);
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", ...options }).format(instant);
  if (style === "parts") {
    return { weekday: fmt({ weekday: "short" }), day: fmt({ day: "numeric" }), month: fmt({ month: "short" }) };
  }
  if (style === "long") return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return fmt({ weekday: "short", day: "numeric", month: "short" });
}

/** `2026-11-12T09:30:00+01:00` → `09:30` (the provider's wall-clock time). */
export function formatTime(localIso: string): string {
  return localIso.slice(11, 16);
}

/** `2026-11-12T09:30:00+01:00` → `2026-11-12`. */
export function localDateOf(localIso: string): string {
  return localIso.slice(0, 10);
}

/** `Europe/Prague` → `Prague`. */
export function timezoneCity(timezone: string): string {
  return (timezone.split("/").pop() ?? timezone).replaceAll("_", " ");
}

/**
 * Short, human-friendly booking reference derived from the booking id. It is
 * not a secret and grants no access (that requires the management token).
 */
export function bookingReference(bookingId: string): string {
  return bookingId.replaceAll("-", "").slice(0, 8).toUpperCase();
}

export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
