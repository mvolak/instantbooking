import { describe, expect, it } from "vitest";
import { toLocalIso } from "@/domain/booking/time";

describe("toLocalIso", () => {
  it.each([
    // Europe/Prague: CET (+01:00) in winter, CEST (+02:00) after the last Sunday of March.
    ["2026-03-23T08:00:00.000Z", "Europe/Prague", "2026-03-23T09:00:00+01:00"],
    ["2026-03-30T07:00:00.000Z", "Europe/Prague", "2026-03-30T09:00:00+02:00"],
    // Around the switch itself: 01:59 CET is followed by 03:00 CEST.
    ["2026-03-29T00:59:00.000Z", "Europe/Prague", "2026-03-29T01:59:00+01:00"],
    ["2026-03-29T01:00:00.000Z", "Europe/Prague", "2026-03-29T03:00:00+02:00"],
    // Local date differs from the UTC date.
    ["2026-03-28T23:30:00.000Z", "Europe/Prague", "2026-03-29T00:30:00+01:00"],
    ["2026-06-11T03:00:00.000Z", "America/New_York", "2026-06-10T23:00:00-04:00"],
    // Zero and non-whole-hour offsets.
    ["2026-06-11T03:00:00.000Z", "UTC", "2026-06-11T03:00:00+00:00"],
    ["2026-06-11T03:00:00.000Z", "Asia/Kolkata", "2026-06-11T08:30:00+05:30"],
  ])("%s in %s → %s", (utc, zone, expected) => {
    expect(toLocalIso(utc, zone)).toBe(expected);
    // Round-trips to the same instant.
    expect(new Date(expected).toISOString()).toBe(utc);
  });

  it("accepts Date instances", () => {
    expect(toLocalIso(new Date("2026-03-23T08:00:00Z"), "Europe/Prague")).toBe("2026-03-23T09:00:00+01:00");
  });
});
