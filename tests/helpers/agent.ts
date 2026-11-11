import { readUIMessageStream, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { streamBookingAgent, type BookingAgentDeps, type BookingUIMessage } from "@/ai/booking-agent";

/** Options the model receives on each call (prompt, tools…). */
export type ModelCall = Parameters<MockLanguageModelV4["doStream"]>[0];
type StreamPart = Record<string, unknown> & { type: string };
/** One scripted model response: inspects the prompt, returns stream parts. */
export type Turn = (call: ModelCall) => StreamPart[];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const finish = (unified: "stop" | "tool-calls"): StreamPart => ({
  type: "finish",
  finishReason: { unified, raw: undefined },
  usage,
});

/** The model replies with text. */
export const say =
  (text: string): Turn =>
  () => [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish("stop"),
  ];

/** The model calls one tool. */
export const callTool =
  (toolCallId: string, toolName: string, input: unknown): Turn =>
  () => [
    { type: "tool-call", toolCallId, toolName, input: typeof input === "string" ? input : JSON.stringify(input) },
    finish("tool-calls"),
  ];

/** Runs `inspect` on the call, then behaves like `turn`. */
export const expecting =
  (inspect: (call: ModelCall) => void, turn: Turn): Turn =>
  (call) => {
    inspect(call);
    return turn(call);
  };

/**
 * A deterministic stand-in for the LLM: each model call consumes the next
 * scripted turn. An unexpected extra call fails loudly.
 */
export function scriptedModel(turns: Turn[]) {
  const calls: ModelCall[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (call) => {
      calls.push(call);
      const turn = turns[calls.length - 1];
      if (!turn) throw new Error(`Unexpected model call #${calls.length}`);
      return { stream: simulateReadableStream({ chunks: turn(call) as never[] }) };
    },
  });
  return { model, calls };
}

/**
 * Runs one request through the agent exactly as the route would and folds the
 * streamed UI chunks into the conversation, like `useChat` does.
 */
export async function runTurn(
  deps: BookingAgentDeps,
  messages: BookingUIMessage[],
): Promise<{ messages: BookingUIMessage[]; assistant: BookingUIMessage; errors: string[] }> {
  const result = await tryTurn(deps, messages);
  if (!result.assistant) throw new Error(`No assistant message produced: ${result.errors.join("; ")}`);
  return result as { messages: BookingUIMessage[]; assistant: BookingUIMessage; errors: string[] };
}

/** Like runTurn, but tolerates a turn that fails before producing a message. */
export async function tryTurn(deps: BookingAgentDeps, messages: BookingUIMessage[]) {
  const errors: string[] = [];
  const stream = await streamBookingAgent(deps, { messages });
  const last = messages.at(-1);
  const continuing = last?.role === "assistant" ? structuredClone(last) : undefined;
  let assistant: BookingUIMessage | undefined = continuing;
  const chunks = stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "error") errors.push(chunk.errorText);
        controller.enqueue(chunk);
      },
    }),
  );
  for await (const snapshot of readUIMessageStream<BookingUIMessage>({ message: continuing, stream: chunks })) {
    assistant = snapshot;
  }
  const history = continuing ? messages.slice(0, -1) : messages;
  return { messages: assistant ? [...history, assistant] : history, assistant, errors };
}

export const userMessage = (text: string, id = `u-${Math.random().toString(36).slice(2)}`): BookingUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

type Part = BookingUIMessage["parts"][number];
export type CreateBookingPart = Extract<Part, { type: "tool-createBooking" }>;

export function toolParts<T extends Part["type"]>(message: BookingUIMessage, type: T) {
  return message.parts.filter((p): p is Extract<Part, { type: T }> => p.type === type);
}

/** What `addToolApprovalResponse` does in the browser. */
export function respondToApproval(messages: BookingUIMessage[], approved: boolean): BookingUIMessage[] {
  const next = structuredClone(messages);
  const part = toolParts(next.at(-1)!, "tool-createBooking").find((p) => p.state === "approval-requested");
  if (!part || part.state !== "approval-requested") throw new Error("No pending approval");
  Object.assign(part, { state: "approval-responded", approval: { ...part.approval, approved } });
  return next;
}

/** Concatenated text of everything the model was given in a call. */
export function promptText(call: ModelCall): string {
  return JSON.stringify(call.prompt);
}

/** The model replies with text streamed in small pieces, like real tokens. */
export const sayStreamed =
  (text: string, pieceLength = 9): Turn =>
  () => [
    { type: "text-start", id: "t" },
    ...Array.from({ length: Math.ceil(text.length / pieceLength) }, (_, i) => ({
      type: "text-delta",
      id: "t",
      delta: text.slice(i * pieceLength, (i + 1) * pieceLength),
    })),
    { type: "text-end", id: "t" },
    finish("stop"),
  ];

/** A ```spec fence with one JSON patch per line, as the model writes it. */
export const specFence = (...patches: (object | string)[]) =>
  ["```spec", ...patches.map((p) => (typeof p === "string" ? p : JSON.stringify(p))), "```"].join("\n");

export const rootPatch = (key: string) => ({ op: "add", path: "/root", value: key });

export const elementPatch = (
  key: string,
  type: string,
  props: Record<string, unknown> = {},
  children: string[] = [],
  extra: Record<string, unknown> = {},
) => ({ op: "add", path: `/elements/${key}`, value: { type, props, children, ...extra } });

/** Text parts of a message, joined. */
export const textOf = (message: BookingUIMessage) =>
  message.parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
