import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Server-side secrets for the conversational channel. Everything is derived
 * from one configured secret with domain-separated HMAC keys, so a value made
 * for one purpose can never be used for another.
 */

function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(`instantbooking:${purpose}:v1`).digest();
}

/** Key handed to the AI SDK to HMAC-sign tool approval requests. */
export function toolApprovalSecret(secret: string): string {
  return deriveKey(secret, "tool-approval").toString("base64url");
}

/**
 * Idempotency key for one approved `createBooking` tool call. It depends only
 * on the (signed) tool call id, so a retried or replayed execution of the same
 * approval maps to the same booking instead of creating a second one. The model
 * never sees or chooses it.
 */
export function bookingIdempotencyKey(secret: string, toolCallId: string): string {
  const mac = createHmac("sha256", deriveKey(secret, "idempotency")).update(toolCallId).digest("base64url");
  return `chat-${mac}`;
}

export type BookingAccess = { bookingId: string; managementToken: string };

const SEAL_AAD = Buffer.from("instantbooking:booking-access:v1");

/**
 * Encrypts and authenticates a booking's management token (AES-256-GCM) so the
 * browser can hold it for the current conversation without being able to read
 * or alter it, and the model never sees it.
 */
export function sealBookingAccess(secret: string, access: BookingAccess): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, "seal"), iv);
  cipher.setAAD(SEAL_AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(access), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns the sealed credential, or null if it was not issued by this server or was tampered with. */
export function openBookingAccess(secret: string, sealed: string): BookingAccess | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret, "seal"), raw.subarray(0, 12));
    decipher.setAAD(SEAL_AAD);
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const value: unknown = JSON.parse(json);
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as BookingAccess).bookingId === "string" &&
      typeof (value as BookingAccess).managementToken === "string"
    ) {
      return value as BookingAccess;
    }
    return null;
  } catch {
    return null;
  }
}
