/**
 * Formats an instant as ISO 8601 local time with the zone's UTC offset at that
 * instant, e.g. `2026-03-23T09:00:00+01:00` (CET) or `2026-03-30T09:00:00+02:00` (CEST).
 *
 * The value is unambiguous (it converts back to the same UTC instant) and is
 * directly displayable, so channels don't each have to re-implement timezone logic.
 */
export function toLocalIso(instant: Date | string, timeZone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  // "GMT+01:00" → "+01:00"; plain "GMT" means a zero offset.
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
