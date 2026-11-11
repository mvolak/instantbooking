import type { SpecDataPart } from "@json-render/core";
import { z } from "zod";

/**
 * Custom data parts carried in chat messages, alongside text and tool parts.
 *
 * - `spec`: one json-render patch (validated server-side before streaming).
 * - `uiNotice`: the server dropped generated UI it could not accept.
 * - `slotSelection`: the authoritative slot id a guest picked in generated UI,
 *   attached to their message so the model never has to map "16:30" back to an id.
 */
export type BookingDataParts = {
  spec: SpecDataPart;
  uiNotice: { kind: "spec-rejected" };
  slotSelection: { slotId: string };
};

export const bookingDataSchemas = {
  // Patches are re-validated before rendering; here only the envelope is checked.
  spec: z.object({ type: z.enum(["patch", "flat", "nested"]) }).passthrough() as unknown as z.ZodType<SpecDataPart>,
  uiNotice: z.object({ kind: z.literal("spec-rejected") }),
  slotSelection: z.strictObject({ slotId: z.guid() }),
};
