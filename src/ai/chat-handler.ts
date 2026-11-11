import "server-only";
import { createUIMessageStreamResponse, safeValidateUIMessages, type LanguageModel } from "ai";
import { z } from "zod";
import type { BookingCapability } from "@/domain/booking";
import { bookingDataSchemas } from "@/genui/data-parts";
import { streamBookingAgent, type BookingUIMessage } from "./booking-agent";
import { readChatConfig, SEARCH_HORIZON_DAYS, STUDIO_TIMEZONE, type ChatConfigResult } from "./config";
import { clientKey, createRateLimiter, type RateLimiter } from "./rate-limit";

/** Request bounds. History beyond the window is dropped, oversized input rejected. */
export const MAX_BODY_BYTES = 200_000;
export const MAX_HISTORY_MESSAGES = 30;
export const MAX_USER_TEXT_CHARS = 2_000;

const bodySchema = z.object({
  id: z.string().max(100).optional(),
  messages: z.array(z.unknown()).min(1).max(200),
});

export type ChatHandlerDeps = {
  readConfig?: () => ChatConfigResult;
  getCapability: () => BookingCapability;
  /** Resolves the configured model id; tests inject a mock model. */
  createModel?: (modelId: string) => LanguageModel;
  rateLimiter?: RateLimiter;
  now?: () => Date;
};

/** `POST /api/chat`: validates and bounds the request, then streams one agent turn. */
export function createChatHandler(deps: ChatHandlerDeps) {
  const readConfig = deps.readConfig ?? (() => readChatConfig());
  const rateLimiter = deps.rateLimiter ?? createRateLimiter({ limit: 20, windowMs: 60_000 });
  // A plain model id string is resolved through Vercel AI Gateway by the AI SDK.
  const createModel = deps.createModel ?? ((id: string): LanguageModel => id);

  return async function POST(request: Request): Promise<Response> {
    const config = readConfig();
    if (!config.ok) {
      return chatError(503, "CHAT_UNAVAILABLE", "The booking assistant is not available right now. Please use the booking form.");
    }

    const retryAfterMs = rateLimiter.hit(clientKey(request));
    if (retryAfterMs > 0) {
      return chatError(429, "RATE_LIMITED", "You're sending messages too quickly. Please wait a moment.", {
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      });
    }

    const parsed = await readMessages(request);
    if (!parsed.ok) return parsed.response;

    const stream = await streamBookingAgent(
      {
        model: createModel(config.config.model),
        capability: deps.getCapability(),
        signingSecret: config.config.signingSecret,
        timeZone: STUDIO_TIMEZONE,
        horizonDays: SEARCH_HORIZON_DAYS,
        now: deps.now,
      },
      { messages: parsed.messages, abortSignal: request.signal },
    );
    return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store" } });
  };
}

async function readMessages(
  request: Request,
): Promise<{ ok: true; messages: BookingUIMessage[] } | { ok: false; response: Response }> {
  const invalid = (message: string) => ({ ok: false as const, response: chatError(400, "INVALID_INPUT", message) });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return invalid("The conversation is too long. Please start a new one.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return invalid("Request body must be valid JSON");
  }
  const body = bodySchema.safeParse(json);
  if (!body.success) return invalid("Request must contain a list of messages");

  const validated = await safeValidateUIMessages<BookingUIMessage>({
    messages: body.data.messages,
    dataSchemas: bookingDataSchemas,
  });
  if (!validated.success) return invalid("Messages are malformed");
  const messages = validated.data;

  // Only the conversation itself is accepted from the client; instructions are server-side.
  if (messages.some((m) => m.role === "system")) return invalid("System messages are not accepted");
  // Guests can attach a slot selection; generated UI parts only come from the assistant.
  const userDataOk = messages.every(
    (m) => m.role !== "user" || m.parts.every((p) => !p.type.startsWith("data-") || p.type === "data-slotSelection"),
  );
  if (!userDataOk) return invalid("Messages are malformed");
  const last = messages.at(-1)!;
  const tooLong = last.parts.some((p) => p.type === "text" && p.text.length > MAX_USER_TEXT_CHARS);
  if (tooLong) return invalid(`Messages can be at most ${MAX_USER_TEXT_CHARS} characters`);

  return { ok: true, messages: boundHistory(messages) };
}

/** Keeps the most recent messages, starting at a user message. */
export function boundHistory<T extends { role: string }>(messages: T[]): T[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((m) => m.role === "user");
  return firstUser > 0 ? recent.slice(firstUser) : recent;
}

function chatError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}
