import "server-only";
import {
  convertToModelMessages,
  InvalidToolApprovalError,
  InvalidToolApprovalSignatureError,
  isStepCount,
  streamText,
  toUIMessageStream,
  type InferUITools,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { BookingCapability } from "@/domain/booking";
import type { BookingDataParts } from "@/genui/data-parts";
import { GENERATIVE_UI_INSTRUCTIONS } from "@/genui/prompt";
import { withGenerativeUI } from "@/genui/stream";
import { bookingInstructions } from "./booking-instructions";
import { createBookingTools, type BookingTools, type CreateBookingOutput } from "./booking-tools";
import { toolApprovalSecret } from "./secrets";

export type BookingUIMessage = UIMessage<never, BookingDataParts, InferUITools<BookingTools>>;

/** Model steps per request (each step = one model call, possibly with tool calls). */
export const MAX_AGENT_STEPS = 6;

export type BookingAgentDeps = {
  model: LanguageModel;
  capability: BookingCapability;
  signingSecret: string;
  timeZone: string;
  horizonDays: number;
  now?: () => Date;
};

/**
 * Runs one conversational turn: the model interprets the conversation and calls
 * booking tools; the result streams back as UI message chunks for `useChat`.
 */
export async function streamBookingAgent(
  deps: BookingAgentDeps,
  { messages, abortSignal }: { messages: BookingUIMessage[]; abortSignal?: AbortSignal },
) {
  const now = deps.now ?? (() => new Date());
  const { tools, refineToolInput, toolApproval } = createBookingTools({
    capability: deps.capability,
    secret: deps.signingSecret,
    now,
    timeZone: deps.timeZone,
    horizonDays: deps.horizonDays,
    sessionAccess: collectSessionAccess(messages),
  });

  const result = streamText({
    model: deps.model,
    instructions: bookingInstructions({ now: now(), timeZone: deps.timeZone, extra: GENERATIVE_UI_INSTRUCTIONS }),
    messages: await convertToModelMessages(messages, {
      tools,
      ignoreIncompleteToolCalls: true,
      // Generated UI is presentation only and is not replayed to the model. A
      // slot picked in that UI reaches it as its authoritative id.
      convertDataPart: (part) =>
        part.type === "data-slotSelection" ? { type: "text", text: `Selected slot: ${(part.data as { slotId: string }).slotId}` } : undefined,
    }),
    tools,
    toolApproval,
    experimental_refineToolInput: refineToolInput,
    // Approvals are HMAC-signed when issued and verified when they come back,
    // so a client cannot fabricate or alter an approved booking.
    experimental_toolApprovalSecret: toolApprovalSecret(deps.signingSecret),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    // Room for a short reply plus a generated UI spec.
    maxOutputTokens: 2048,
    abortSignal,
  });

  const uiStream = toUIMessageStream<BookingTools, BookingUIMessage>({
    stream: result.stream,
    tools,
    originalMessages: messages,
    onError: publicErrorMessage,
  });
  // Spec fences in the model's text become `data-spec` patch parts, which are
  // then validated against the catalog before anything reaches the browser.
  return withGenerativeUI(uiStream);
}

/** Sealed booking credentials from earlier `createBooking` results in this conversation. */
export function collectSessionAccess(messages: BookingUIMessage[]): string[] {
  const sealed: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool-createBooking" || part.state !== "output-available") continue;
      const output = part.output as CreateBookingOutput | undefined;
      if (output?.status === "confirmed" && typeof output.access === "string") sealed.push(output.access);
    }
  }
  return sealed.slice(-10);
}

/** Error text safe to show to visitors. Internal details are only logged on the server. */
export function publicErrorMessage(error: unknown): string {
  if (InvalidToolApprovalSignatureError.isInstance(error) || InvalidToolApprovalError.isInstance(error)) {
    return "That confirmation could not be verified, so nothing was booked. Please ask again.";
  }
  console.error("[chat] agent error:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  return "Sorry, the booking assistant is unavailable right now. You can still book with the form above.";
}
