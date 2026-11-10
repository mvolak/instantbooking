// @vitest-environment jsdom
import "./setup";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatTransport, UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { BookingChat } from "@/components/chat/BookingChat";

type Sent = Parameters<ChatTransport<BookingUIMessage>["sendMessages"]>[0];
type Reply = UIMessageChunk[] | ((stream: ManualStream) => void) | Error;

/** A stream the test feeds chunk by chunk. */
class ManualStream {
  controller!: ReadableStreamDefaultController<UIMessageChunk>;
  readonly stream = new ReadableStream<UIMessageChunk>({ start: (c) => void (this.controller = c) });
  push(...chunks: UIMessageChunk[]) {
    chunks.forEach((c) => this.controller.enqueue(c));
  }
  close() {
    this.controller.close();
  }
}

/** Fake `/api/chat`: records each request and answers with the next scripted reply. */
function fakeTransport(replies: Reply[]) {
  const requests: Sent[] = [];
  const transport: ChatTransport<BookingUIMessage> = {
    async sendMessages(options) {
      requests.push(structuredClone({ ...options, abortSignal: undefined }) as Sent);
      const reply = replies[requests.length - 1];
      if (!reply) throw new Error("unexpected request");
      if (reply instanceof Error) throw reply;
      const manual = new ManualStream();
      if (typeof reply === "function") reply(manual);
      else {
        manual.push(...reply);
        manual.close();
      }
      return manual.stream;
    },
    async reconnectToStream() {
      return null;
    },
  };
  return { transport, requests };
}

const text = (id: string, value: string): UIMessageChunk[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: value },
  { type: "text-end", id },
];

const REVIEW = {
  serviceName: "Initial Physiotherapy Consultation",
  providerName: "Motion Studio",
  date: "2026-11-12",
  dateLabel: "Thursday 12 November 2026",
  startTime: "16:30",
  endTime: "17:00",
  timeZone: "Europe/Prague",
};
const SEALED = "SEALED-CREDENTIAL-should-never-be-rendered";

const approvalRequest: UIMessageChunk[] = [
  { type: "start", messageId: "a1" },
  { type: "start-step" },
  ...text("t1", "Here are the details, please confirm."),
  {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "createBooking",
    input: { slotId: "slot-1", guestName: "Jana Nováková", review: REVIEW },
  },
  { type: "tool-approval-request", toolCallId: "call-1", approvalId: "approval-1" },
  { type: "finish-step" },
  { type: "finish" },
];

const confirmed: UIMessageChunk[] = [
  { type: "start", messageId: "a1" },
  { type: "start-step" },
  {
    type: "tool-output-available",
    toolCallId: "call-1",
    output: {
      status: "confirmed",
      access: SEALED,
      booking: { ...REVIEW, reference: "3F9A12BC", guestName: "Jana Nováková", status: "confirmed" },
    },
  },
  { type: "finish-step" },
  { type: "start-step" },
  ...text("t2", "You're booked for Thursday 12 November at 16:30."),
  { type: "finish-step" },
  { type: "finish" },
];

function setup(replies: Reply[]) {
  const fake = fakeTransport(replies);
  const user = userEvent.setup();
  render(<BookingChat transport={fake.transport} />);
  const input = () => screen.getByLabelText("Message the booking assistant");
  return { ...fake, user, input };
}

const log = () => screen.getByRole("log", { name: /conversation/i });
const sentParts = (request: Sent) => request.messages.at(-1)!.parts;

describe("BookingChat", () => {
  it("streams the assistant's reply as it arrives", async () => {
    let live!: ManualStream;
    const { user, input, requests } = setup([(s) => (live = s)]);

    await user.type(input(), "Do you have anything on Thursday afternoon?{Enter}");
    expect(within(log()).getByText("Do you have anything on Thursday afternoon?")).toBeInTheDocument();
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    expect(requests[0].messages.at(-1)).toMatchObject({ role: "user" });

    live.push({ type: "start", messageId: "a1" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "On Thursday " });
    expect(await within(log()).findByText("On Thursday")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    live.push({ type: "text-delta", id: "t", delta: "I have 14:00 and 16:30." }, { type: "text-end", id: "t" }, { type: "finish" });
    live.close();
    expect(await within(log()).findByText("On Thursday I have 14:00 and 16:30.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(input()).toHaveValue("");
  });

  it("starts a conversation from a suggestion", async () => {
    const { user, requests } = setup([[...text("t", "We offer one service.")]]);
    await user.click(screen.getByRole("button", { name: "What kind of appointments do you offer?" }));
    await within(log()).findByText("We offer one service.");
    expect(sentParts(requests[0])).toEqual([{ type: "text", text: "What kind of appointments do you offer?" }]);
  });

  it("uses Shift+Enter for a new line and Enter to send", async () => {
    const { user, input, requests } = setup([[...text("t", "ok")]]);
    await user.type(input(), "line one{Shift>}{Enter}{/Shift}line two");
    expect(requests).toHaveLength(0);
    expect(input()).toHaveValue("line one\nline two");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it("shows server-validated details and books only after explicit confirmation", async () => {
    const { user, input, requests } = setup([approvalRequest, confirmed]);
    await user.type(input(), "Book the 16:30 for Jana Nováková{Enter}");

    const review = await screen.findByRole("region", { name: "Please confirm your booking" });
    expect(within(review).getByText("Thursday 12 November 2026")).toBeInTheDocument();
    expect(within(review).getByText("16:30–17:00 (Prague time)")).toBeInTheDocument();
    expect(within(review).getByText("Initial Physiotherapy Consultation")).toBeInTheDocument();
    expect(within(review).getByText("Jana Nováková")).toBeInTheDocument();
    expect(requests).toHaveLength(1);

    const confirm = within(review).getByRole("button", { name: "Confirm booking" });
    await user.dblClick(confirm);

    const done = await screen.findByTestId("chat-booking-confirmation");
    expect(within(done).getByText("3F9A12BC")).toBeInTheDocument();
    expect(within(done).getByText("Confirmed")).toBeInTheDocument();
    expect(await within(log()).findByText(/You're booked for Thursday 12 November/)).toBeInTheDocument();

    // Exactly one follow-up request, carrying the approval for this tool call.
    expect(requests).toHaveLength(2);
    expect(sentParts(requests[1])).toContainEqual(
      expect.objectContaining({
        type: "tool-createBooking",
        state: "approval-responded",
        approval: expect.objectContaining({ id: "approval-1", approved: true }),
      }),
    );
    // The sealed credential stays in memory only; it is never rendered.
    expect(document.body.innerHTML).not.toContain(SEALED);
  });

  it("sends a rejection when the guest cancels", async () => {
    const cancelled: UIMessageChunk[] = [
      { type: "start", messageId: "a1" },
      { type: "tool-output-denied", toolCallId: "call-1" },
      ...text("t3", "No problem, nothing was booked."),
      { type: "finish" },
    ];
    const { user, input, requests } = setup([approvalRequest, cancelled]);
    await user.type(input(), "Book it{Enter}");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Booking cancelled. Nothing was booked.")).toBeInTheDocument();
    expect(sentParts(requests[1])).toContainEqual(
      expect.objectContaining({ approval: expect.objectContaining({ approved: false }) }),
    );
    expect(screen.queryByTestId("chat-booking-confirmation")).not.toBeInTheDocument();
  });

  it("explains a conflict instead of confirming", async () => {
    const conflict: UIMessageChunk[] = [
      { type: "start", messageId: "a1" },
      {
        type: "tool-output-available",
        toolCallId: "call-1",
        output: { status: "slot_unavailable", message: "This time is no longer available; someone else booked it first. Nothing was booked." },
      },
      { type: "finish" },
    ];
    const { user, input } = setup([approvalRequest, conflict]);
    await user.type(input(), "Book it{Enter}");
    await user.click(await screen.findByRole("button", { name: "Confirm booking" }));
    expect(await screen.findByText(/someone else booked it first/)).toBeInTheDocument();
    expect(screen.queryByTestId("chat-booking-confirmation")).not.toBeInTheDocument();
  });

  it("shows found times as buttons that continue the conversation", async () => {
    const slots: UIMessageChunk[] = [
      { type: "start", messageId: "a1" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "findAvailableSlots", input: { serviceId: "s", date: "2026-11-12" } },
      {
        type: "tool-output-available",
        toolCallId: "c1",
        output: {
          status: "ok",
          date: "2026-11-12",
          dateLabel: "Thursday 12 November 2026",
          weekday: "Thursday",
          timeZone: "Europe/Prague",
          slots: [
            { slotId: "x1", startTime: "14:00", endTime: "14:30", startsAtUtc: "", providerName: "M", providerTimezone: "Europe/Prague" },
          ],
        },
      },
      { type: "finish" },
    ];
    const { user, input, requests } = setup([slots, [...text("t", "Great, what's your name?")]]);
    await user.type(input(), "Thursday?{Enter}");
    const times = await screen.findByRole("list", { name: "Free times on Thursday 12 November 2026" });
    await user.click(within(times).getByRole("button", { name: "14:00" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(sentParts(requests[1])).toEqual([
      { type: "text", text: "I'd like the 14:00 appointment on Thursday 12 November 2026." },
    ]);
  });

  it("shows a friendly error with a retry when the assistant is unavailable", async () => {
    const unavailable = new Error(
      JSON.stringify({ error: { code: "CHAT_UNAVAILABLE", message: "The booking assistant is not available right now. Please use the booking form." } }),
    );
    const { user, input, requests } = setup([unavailable, [...text("t", "Back online!")]]);
    await user.type(input(), "Hello{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The booking assistant is not available right now. Please use the booking form.");
    await user.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(await within(log()).findByText("Back online!")).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it("does not leak raw network errors", async () => {
    const { user, input } = setup([new TypeError("Failed to fetch")]);
    await user.type(input(), "Hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t reach the booking assistant");
  });
});
