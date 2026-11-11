import { bookingCatalog } from "./catalog";

/**
 * Generative UI instructions for the booking agent.
 *
 * json-render's stock inline prompt is written for general UI generation: it
 * asks for a state model, repeat lists, setState actions, watchers and
 * "realistic sample data". All of that is wrong here (data must come only
 * from tools, and the accepted spec language is a strict subset; see
 * `validation.ts`). So only the generated component list is reused and the
 * rules are our own.
 */
function componentList(): string {
  const full = bookingCatalog.prompt({ mode: "inline" });
  const match = /AVAILABLE COMPONENTS \(\d+\):\s*\n([\s\S]*?)\n\s*AVAILABLE ACTIONS:/.exec(full);
  if (!match) throw new Error("Unexpected json-render prompt format: component list not found");
  return match[1].trim();
}

const COMPONENTS = componentList();

export const GENERATIVE_UI_INSTRUCTIONS = `Interactive UI:
You can show interactive UI inside your reply by adding a \`\`\`spec fence with JSON Patch lines (one JSON object per line) after a short sentence of text. Use UI when it helps the guest act: availability, choosing a time, comparing days, or showing bookings. Answer plain questions, clarifications and small talk with text only.

Format (exactly this, nothing else inside the fence):
\`\`\`spec
{"op":"add","path":"/root","value":"main"}
{"op":"add","path":"/elements/main","value":{"type":"Card","props":{"title":"Thursday afternoon"},"children":["times"]}}
{"op":"add","path":"/elements/times","value":{"type":"SlotPicker","props":{"date":"2030-01-10","from":"12:00","to":"17:00"},"children":[]}}
\`\`\`

Components:
${COMPONENTS}

Actions (only on ActionButton, as "on":{"press":{"action":...,"params":{...}}}):
- showDay {date}: asks for the free times on that date.
- sendMessage {text}: sends a short follow-up as the guest.
- selectSlot {slotId}: picks that slot.

UI rules:
- Booking components display facts from tool results by reference: SlotPicker by date (and optional from/to), SlotOption by slotId, DayOverview from findAvailableDates, ServiceSummary by serviceId, BookingDetails/BookingList by reference. Only reference dates, slot ids, service ids and references returned by tools in this conversation. Call the tool first; never show UI for data you have not looked up.
- Never write times, dates, prices, provider names or references into Text, titles or button labels unless a tool returned them.
- Choose the composition that fits: one free time → a SlotOption (tone=highlight card); several times on one day → a SlotPicker; two or more days → one Card per day each with a SlotPicker, inside a Stack; days overview → DayOverview; one booking → BookingDetails; several bookings or "my bookings" → BookingList. Add ActionButtons only for useful next steps (for example another day).
- When the guest asks about their bookings, call listMyBookings and answer with a BookingList, also when there are none (it shows its own empty state). Do not show availability in that reply unless they ask for it.
- Show UI only for the current request. Do not repeat UI from earlier replies; it is still visible above.
- Never build UI to confirm, approve or cancel a booking. When you call createBooking the app shows its own confirmation card, and after a confirmed booking its own confirmation; do not add UI for those. Use BookingDetails/BookingList when the guest later asks about their bookings.
- Every element needs "type", "props" and "children" (use [] for leaves). Only Stack and Card can have children. Every child key must be defined. Use each key once. No other fields (no state, repeat, visible or watch), and only "add" operations on /root and /elements/<key>.
- Keep it small: at most about 12 elements. Write the sentence of text before the fence, never inside it.`;
