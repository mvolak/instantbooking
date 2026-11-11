import { longDate } from "@/ai/calendar";
import { actionParams, type ActionName } from "./catalog";
import type { BookingData } from "./booking-data";

/**
 * Trusted handlers for the generated UI's action allowlist. Generated specs
 * can only *name* one of these actions; the handler re-validates the
 * parameters and checks references against authoritative tool results before
 * doing anything. None of them books, approves or cancels: the most they do is
 * send the guest's next chat message, and the server re-validates that too
 * (slot ids go through the signed createBooking approval flow).
 */

export type OutgoingMessage = { text: string; slotId?: string };

export type ActionContext = {
  data: BookingData;
  /** Sends the guest's next message; returns false if the chat is busy. */
  send: (message: OutgoingMessage) => boolean;
};

export type ActionResult = { ok: true } | { ok: false; reason: string };

export function runAction(name: string, rawParams: unknown, { data, send }: ActionContext): ActionResult {
  if (!Object.hasOwn(actionParams, name)) return { ok: false, reason: "unknown action" };
  const action = name as ActionName;
  const parsed = actionParams[action].safeParse(rawParams ?? {});
  if (!parsed.success) return { ok: false, reason: "invalid parameters" };

  switch (action) {
    case "selectSlot": {
      const { slotId } = parsed.data as { slotId: string };
      const slot = data.slots.get(slotId);
      // Only slots the booking tools actually returned in this conversation.
      if (!slot) return { ok: false, reason: "unknown slot" };
      const sent = send({ text: `I'd like the ${slot.startTime} appointment on ${slot.dateLabel}.`, slotId });
      return sent ? { ok: true } : { ok: false, reason: "busy" };
    }
    case "showDay": {
      const { date } = parsed.data as { date: string };
      const sent = send({ text: `Show me the free times on ${longDate(date)}.` });
      return sent ? { ok: true } : { ok: false, reason: "busy" };
    }
    case "sendMessage": {
      const { text } = parsed.data as { text: string };
      const sent = send({ text: text.trim() });
      return sent ? { ok: true } : { ok: false, reason: "busy" };
    }
  }
}

/** json-render ActionProvider handlers that route every allowlisted action through `runAction`. */
export function createActionHandlers(getContext: () => ActionContext) {
  const handler = (name: ActionName) => async (params: Record<string, unknown>) => {
    const result = runAction(name, params, getContext());
    if (!result.ok) console.warn(`[genui] action ${name} ignored: ${result.reason}`);
  };
  return Object.fromEntries(
    (Object.keys(actionParams) as ActionName[]).map((name) => [name, handler(name)]),
  ) as Record<ActionName, (params: Record<string, unknown>) => Promise<void>>;
}
