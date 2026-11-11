"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type ChatTransport } from "ai";
import { MessageCircle, SendHorizontal, Square } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { ErrorMessage, Spinner } from "@/components/booking/feedback";
import type { ActionContext, OutgoingMessage } from "@/genui/actions";
import { collectBookingData } from "@/genui/booking-data";
import { GeneratedUI } from "@/genui/renderer";
import { checkSpec, specSegments } from "@/genui/validation";
import { BookingApproval } from "./BookingApproval";
import { ToolActivity } from "./ToolActivity";

// json-render devtools in development only. The condition is inlined at build
// time, so production bundles never load it.
const GenUIDevtools =
  process.env.NODE_ENV === "development" ? dynamic(() => import("@/genui/devtools"), { ssr: false }) : null;

const SUGGESTIONS = [
  "What kind of appointments do you offer?",
  "Do you have anything on Thursday afternoon?",
  "When is the next free appointment?",
];

type Props = {
  /** Injected in tests; defaults to the `/api/chat` endpoint. */
  transport?: ChatTransport<BookingUIMessage>;
};

/**
 * Conversational booking panel. The conversation lives only in this page's
 * memory; bookings still require explicit confirmation in a review card.
 */
export function BookingChat({ transport }: Props) {
  const [chatTransport] = useState(() => transport ?? new DefaultChatTransport<BookingUIMessage>({ api: "/api/chat" }));
  const { messages, sendMessage, addToolApprovalResponse, status, error, regenerate, stop, clearError } =
    useChat<BookingUIMessage>({
      transport: chatTransport,
      // After the guest confirms or cancels, continue the turn automatically.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });
  const [input, setInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, status]);

  function send(text: string, slotId?: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || busy) return false;
    if (error) clearError();
    void sendMessage({
      parts: [
        { type: "text", text: trimmed },
        // The exact slot picked in the UI travels with the message as data.
        ...(slotId ? [{ type: "data-slotSelection" as const, data: { slotId } }] : []),
      ],
    });
    setInput("");
    return true;
  }

  // Authoritative booking data (tool results) that generated UI resolves against.
  const data = useMemo(() => collectBookingData(messages), [messages]);
  const actionContext: ActionContext = {
    data,
    send: ({ text, slotId }: OutgoingMessage) => send(text, slotId),
  };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex h-[min(36rem,80svh)] flex-col overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-sm">
      <div
        ref={logRef}
        role="log"
        aria-label="Conversation with the booking assistant"
        aria-busy={busy}
        className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5"
      >
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-ink">
              <MessageCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-sage-700" />
              Hi! Tell me when suits you and I’ll find a free appointment. You can also try:
            </p>
            <ul className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => send(suggestion)}
                    className="min-h-9 rounded-full border border-sand-300 bg-sand-50 px-3 text-left text-sm text-ink transition hover:border-sage-500"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message, messageIndex) => {
          const streamingThis = busy && messageIndex === messages.length - 1;
          const segments = message.role === "assistant" ? specSegments(message.parts) : [];
          const hasUI = segments.some((segment) => checkSpec(segment.spec, { final: true }).ok);
          return (
          <article
            key={message.id}
            aria-label={message.role === "user" ? "You" : "Assistant"}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-md bg-sage-700 px-3.5 py-2 text-sm text-white"
                  : "w-full max-w-[92%] space-y-2.5 text-sm text-ink"
              }
            >
              {message.parts.map((part, index) => {
                const key = `${message.id}-${index}`;
                switch (part.type) {
                  case "data-spec": {
                    const segment = segments.find((s) => s.start === index);
                    return segment ? (
                      <GeneratedUI
                        key={key}
                        segment={segment}
                        streaming={streamingThis}
                        context={actionContext}
                        disabled={busy}
                      />
                    ) : null;
                  }
                  case "text":
                    return part.text ? (
                      <p key={key} className="leading-relaxed break-words whitespace-pre-wrap">
                        {part.text}
                      </p>
                    ) : null;
                  case "tool-createBooking":
                    return (
                      <BookingApproval
                        key={part.toolCallId}
                        part={part}
                        disabled={busy}
                        onRespond={(id, approved) => void addToolApprovalResponse({ id, approved })}
                      />
                    );
                  case "tool-listServices":
                  case "tool-findAvailableDates":
                  case "tool-findAvailableSlots":
                  case "tool-getBooking":
                  case "tool-listMyBookings":
                    return (
                      <ToolActivity
                        key={part.toolCallId}
                        part={part}
                        onPickTime={send}
                        disabled={busy}
                        showTimes={!hasUI && !streamingThis}
                      />
                    );
                  default:
                    return null;
                }
              })}
            </div>
          </article>
          );
        })}

        {status === "submitted" && (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner />
            Thinking…
          </p>
        )}

        {error && (
          <ErrorMessage
            onRetry={() => {
              clearError();
              void regenerate();
            }}
          >
            {friendlyError(error)}
          </ErrorMessage>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-sand-200 bg-sand-50 p-3">
        <label htmlFor="chat-input" className="sr-only">
          Message the booking assistant
        </label>
        <textarea
          id="chat-input"
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={2000}
          placeholder="e.g. Anything on Friday morning?"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-sand-300 bg-white px-3 py-2.5 text-base text-ink placeholder:text-ink-muted/70 sm:text-sm"
        />
        {status === "streaming" ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-sand-300 bg-white text-ink transition hover:border-sage-500"
          >
            <Square aria-hidden className="size-4" />
            <span className="sr-only">Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white transition hover:bg-sage-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizontal aria-hidden className="size-4" />
            <span className="sr-only">Send</span>
          </button>
        )}
      </form>
      {GenUIDevtools && <GenUIDevtools messages={messages} />}
    </div>
  );
}

/** HTTP errors arrive as the response body (`{ error: { message } }`); stream errors as plain text. */
function friendlyError(error: Error): string {
  try {
    const body = JSON.parse(error.message) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // not JSON
  }
  if (error.message && error.message.length < 200 && !/fetch|network/i.test(error.message)) return error.message;
  return "We couldn’t reach the booking assistant. Please check your connection and try again.";
}
