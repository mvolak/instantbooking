import { describe, expect, it } from "vitest";
import { bookingInstructions } from "@/ai/booking-instructions";
import { addDays, daysBetween, localDate, localTime, longDate } from "@/ai/calendar";
import { DEFAULT_BOOKING_MODEL, readChatConfig } from "@/ai/config";
import { bookingIdempotencyKey, openBookingAccess, sealBookingAccess, toolApprovalSecret } from "@/ai/secrets";
import { idempotencyKeySchema } from "@/schemas/booking";

const SECRET = "unit-test-secret-0123456789abcdefgh";

describe("studio calendar", () => {
  it("uses the Prague date, not the UTC date, around midnight", () => {
    // 23:30 UTC on Tuesday is already 00:30 on Wednesday in Prague (UTC+1).
    const instant = new Date("2030-01-08T23:30:00Z");
    expect(localDate(instant, "Europe/Prague")).toBe("2030-01-09");
    expect(localTime(instant, "Europe/Prague")).toBe("00:30");
    // In summer Prague is UTC+2.
    expect(localTime(new Date("2026-07-01T22:15:00Z"), "Europe/Prague")).toBe("00:15");
  });

  it("does date arithmetic across DST changes", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(longDate("2026-11-12")).toBe("Thursday 12 November 2026");
  });

  it("gives the model today and an explicit weekday-to-date calendar", () => {
    const text = bookingInstructions({ now: new Date("2030-01-08T23:30:00Z"), timeZone: "Europe/Prague" });
    expect(text).toContain("Current date and time: Wednesday 9 January 2030, 00:30 (Europe/Prague)");
    expect(text).toContain("- Wednesday 9 January 2030 (today): 2030-01-09");
    expect(text).toContain("- Thursday 10 January 2030 (tomorrow): 2030-01-10");
    expect(text).toContain("- Tuesday 22 January 2030: 2030-01-22");
    expect(text).not.toContain("2030-01-23");
    expect(text).toMatch(/ask which day they mean instead of guessing/);
  });
});

describe("chat secrets", () => {
  it("derives stable, valid idempotency keys per tool call", () => {
    const a = bookingIdempotencyKey(SECRET, "call_1");
    expect(bookingIdempotencyKey(SECRET, "call_1")).toBe(a);
    expect(bookingIdempotencyKey(SECRET, "call_2")).not.toBe(a);
    expect(bookingIdempotencyKey(`${SECRET}x`, "call_1")).not.toBe(a);
    expect(idempotencyKeySchema.safeParse(a).success).toBe(true);
  });

  it("keeps purposes separate", () => {
    expect(toolApprovalSecret(SECRET)).not.toBe(toolApprovalSecret(`${SECRET}x`));
    expect(toolApprovalSecret(SECRET)).not.toContain(SECRET);
  });

  it("seals booking credentials so they can't be read or altered", () => {
    const access = { bookingId: "b0b0b0b0-0000-4000-8000-000000000000", managementToken: "x".repeat(43) };
    const sealed = sealBookingAccess(SECRET, access);
    expect(sealed).not.toContain(access.managementToken);
    expect(sealed).not.toContain(access.bookingId);
    expect(openBookingAccess(SECRET, sealed)).toEqual(access);

    const flipped = Buffer.from(sealed, "base64url");
    flipped[flipped.length - 1] ^= 1;
    expect(openBookingAccess(SECRET, flipped.toString("base64url"))).toBeNull();
    expect(openBookingAccess("another-secret-0123456789abcdefghij", sealed)).toBeNull();
    expect(openBookingAccess(SECRET, "garbage")).toBeNull();
  });
});

describe("chat configuration", () => {
  it("is disabled until the gateway key and signing secret are set", () => {
    expect(readChatConfig({})).toEqual({ ok: false, missing: ["AI_GATEWAY_API_KEY", "CHAT_SIGNING_SECRET"] });
    expect(readChatConfig({ AI_GATEWAY_API_KEY: "k", CHAT_SIGNING_SECRET: "too-short" })).toEqual({
      ok: false,
      missing: ["CHAT_SIGNING_SECRET"],
    });
  });

  it("defaults to an economical model and allows overriding it", () => {
    const env = { AI_GATEWAY_API_KEY: "k", CHAT_SIGNING_SECRET: SECRET };
    expect(readChatConfig(env)).toEqual({ ok: true, config: { model: DEFAULT_BOOKING_MODEL, signingSecret: SECRET } });
    expect(readChatConfig({ ...env, BOOKING_AI_MODEL: "openai/gpt-4.1-mini" })).toMatchObject({
      config: { model: "openai/gpt-4.1-mini" },
    });
  });
});
