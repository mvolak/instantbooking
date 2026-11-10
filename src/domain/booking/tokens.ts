import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit random token, base64url encoded (43 characters). */
export function generateManagementToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest. Tokens are high-entropy, so an unsalted fast hash is appropriate. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256Hex(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
