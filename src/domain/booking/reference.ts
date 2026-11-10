/**
 * Short, human-friendly booking reference derived from the booking id. It is
 * not a secret and grants no access (that requires the management token).
 */
export function bookingReference(bookingId: string): string {
  return bookingId.replaceAll("-", "").slice(0, 8).toUpperCase();
}
