import { describe, expect, it } from "vitest";
import { createBookingCapability, BookingError, type BookingRepository } from "@/domain/booking";
import { generateManagementToken, sha256Hex, verifyToken } from "@/domain/booking/tokens";
import { createBookingInput, findAvailableSlotsInput } from "@/schemas/booking";

describe("management tokens", () => {
  it("are 256-bit base64url strings and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateManagementToken));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("verify only against their own hash", () => {
    const token = generateManagementToken();
    const hash = sha256Hex(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(generateManagementToken(), hash)).toBe(false);
    expect(verifyToken(token, "not-a-hash")).toBe(false);
  });
});

describe("input schemas", () => {
  const slotId = "6f1d7a2e-3a1b-4c5d-8e9f-0a1b2c3d4e5f";

  it("trims guest names and rejects empty or control characters", () => {
    const ok = createBookingInput.parse({ slotId, guestName: "  Jana  ", idempotencyKey: "k".repeat(16) });
    expect(ok.guestName).toBe("Jana");
    expect(createBookingInput.safeParse({ slotId, guestName: "   ", idempotencyKey: "k".repeat(16) }).success).toBe(false);
    expect(createBookingInput.safeParse({ slotId, guestName: "a\nb", idempotencyKey: "k".repeat(16) }).success).toBe(false);
    expect(createBookingInput.safeParse({ slotId, guestName: "x".repeat(101), idempotencyKey: "k".repeat(16) }).success).toBe(false);
  });

  it("requires a sufficiently long printable idempotency key", () => {
    expect(createBookingInput.safeParse({ slotId, guestName: "J", idempotencyKey: "short" }).success).toBe(false);
    expect(createBookingInput.safeParse({ slotId, guestName: "J", idempotencyKey: "has spaces in the key" }).success).toBe(false);
  });

  it("accepts only real calendar dates", () => {
    expect(findAvailableSlotsInput.safeParse({ serviceId: slotId, date: "2026-03-23" }).success).toBe(true);
    for (const date of ["2026-02-30", "23.03.2026", "2026-3-1", "2026-03-23T00:00:00Z", ""]) {
      expect(findAvailableSlotsInput.safeParse({ serviceId: slotId, date }).success, date).toBe(false);
    }
  });
});

describe("capability input validation", () => {
  // Validation must reject bad input before touching persistence.
  const untouchable = new Proxy({} as BookingRepository, {
    get: () => () => {
      throw new Error("repository must not be called");
    },
  });
  const capability = createBookingCapability({ repository: untouchable });

  it.each([
    ["findAvailableSlots with bad id", () => capability.findAvailableSlots("nope", "2026-03-23")],
    ["findAvailableSlots with bad date", () => capability.findAvailableSlots("6f1d7a2e-3a1b-4c5d-8e9f-0a1b2c3d4e5f", "tomorrow")],
    ["createBooking with bad slot id", () => capability.createBooking("1", "Jana", "k".repeat(16))],
    ["getBooking with bad booking id", () => capability.getBooking("1", "token")],
  ])("%s → INVALID_INPUT", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call()).rejects.toBeInstanceOf(BookingError);
  });

  it("getBooking without a token → UNAUTHORIZED", async () => {
    await expect(capability.getBooking("6f1d7a2e-3a1b-4c5d-8e9f-0a1b2c3d4e5f", "")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
