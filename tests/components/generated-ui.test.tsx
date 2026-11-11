// @vitest-environment jsdom
import "./setup";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatTransport, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { BookingChat } from "@/components/chat/BookingChat";

/**
 * Generated UI inside the chat panel. The fake transport delivers chunks
 * straight to the browser, bypassing the server's validation, so these tests
 * also prove that the client re-validates everything it renders.
 */

type Sent = Parameters<ChatTransport<BookingUIMessage>["sendMessages"]>[0];

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

type Reply = UIMessageChunk[] | ((stream: ManualStream) => void);

function setup(replies: Reply[]) {
  const requests: Sent[] = [];
  const transport: ChatTransport<BookingUIMessage> = {
    async sendMessages(options) {
      requests.push(structuredClone({ ...options, abortSignal: undefined }) as Sent);
      const reply = replies[requests.length - 1];
      if (!reply) throw new Error("unexpected request");
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
  const user = userEvent.setup();
  render(<BookingChat transport={transport} />);
  const input = () => screen.getByLabelText("Message the booking assistant");
  return { requests, user, input };
}

const text = (id: string, value: string): UIMessageChunk[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: value },
  { type: "text-end", id },
];
const spec = (...patches: object[]): UIMessageChunk[] =>
  patches.map((patch) => ({ type: "data-spec", data: { type: "patch", patch } }) as UIMessageChunk);
const root = (key: string) => ({ op: "add", path: "/root", value: key });
const el = (key: string, type: string, props: object = {}, children: string[] = [], extra: object = {}) => ({
  op: "add",
  path: `/elements/${key}`,
  value: { type, props, children, ...extra },
});

const S1400 = "11111111-2222-4333-8444-000000001400";
const S1630 = "11111111-2222-4333-8444-000000001630";

const slotsFound = (id = "c1"): UIMessageChunk[] => [
  { type: "tool-input-available", toolCallId: id, toolName: "findAvailableSlots", input: { serviceId: "svc", date: "2030-01-10" } },
  {
    type: "tool-output-available",
    toolCallId: id,
    output: {
      status: "ok",
      date: "2030-01-10",
      dateLabel: "Thursday 10 January 2030",
      weekday: "Thursday",
      timeZone: "Europe/Prague",
      slots: [
        { slotId: S1400, startTime: "14:00", endTime: "14:30", startsAtUtc: "", providerName: "Eva Physio", providerTimezone: "Europe/Prague" },
        { slotId: S1630, startTime: "16:30", endTime: "17:00", startsAtUtc: "", providerName: "Eva Physio", providerTimezone: "Europe/Prague" },
      ],
    },
  },
];

const availabilityReply: UIMessageChunk[] = [
  { type: "start", messageId: "a1" },
  ...slotsFound(),
  ...text("t", "Here are Thursday's times."),
  ...spec(
    root("main"),
    el("main", "Card", { title: "Thursday afternoon" }, ["times", "more"]),
    el("times", "SlotPicker", { date: "2030-01-10" }),
    el("more", "ActionButton", { label: "Try Friday" }, [], {
      on: { press: { action: "showDay", params: { date: "2030-01-11" } } },
    }),
  ),
  { type: "finish" },
];

const sentParts = (request: Sent) => request.messages.at(-1)!.parts;
const ui = () => screen.getByTestId("generated-ui");

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("generated UI in the chat", () => {
  it("renders availability from tool results and selects a slot by its id", async () => {
    const { user, input, requests } = setup([availabilityReply, [...text("t2", "What name should I use?")]]);
    await user.type(input(), "Thursday afternoon?{Enter}");

    await screen.findByTestId("generated-ui");
    expect(within(ui()).getByText("Thursday afternoon")).toBeInTheDocument();
    const times = within(ui()).getByRole("list", { name: "Free times on Thursday 10 January 2030" });
    expect(within(times).getAllByRole("button").map((b) => b.textContent)).toEqual(["14:00", "16:30"]);
    // The deterministic fallback list is not shown when generated UI is present.
    expect(screen.getAllByRole("list", { name: "Free times on Thursday 10 January 2030" })).toEqual([times]);

    await user.click(within(times).getByRole("button", { name: /Select 16:30–17:00 on Thursday 10 January 2030/ }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(sentParts(requests[1])).toEqual([
      { type: "text", text: "I'd like the 16:30 appointment on Thursday 10 January 2030." },
      { type: "data-slotSelection", data: { slotId: S1630 } },
    ]);
    // Selected state is shown once the selection is part of the conversation.
    await waitFor(() =>
      expect(within(ui()).getByRole("button", { name: /Select 16:30/ })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("runs allowlisted button actions as guest messages", async () => {
    const { user, input, requests } = setup([availabilityReply, [...text("t2", "Friday has 10:00.")]]);
    await user.type(input(), "Thursday afternoon?{Enter}");
    await user.click(await screen.findByRole("button", { name: "Try Friday" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(sentParts(requests[1])).toEqual([{ type: "text", text: "Show me the free times on Friday 11 January 2030." }]);
  });

  it("works with the keyboard", async () => {
    const { user, input, requests } = setup([availabilityReply, [...text("t2", "Name?")]]);
    await user.type(input(), "Thursday?{Enter}");
    const first = await screen.findByRole("button", { name: /Select 14:00/ });
    first.focus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: /Select 16:30/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(sentParts(requests[1])).toContainEqual({ type: "data-slotSelection", data: { slotId: S1630 } });
  });

  it("never shows times that no tool returned", async () => {
    const { user, input } = setup([
      [
        { type: "start", messageId: "a1" },
        ...slotsFound(),
        ...text("t", "Options:"),
        ...spec(
          root("main"),
          el("main", "Stack", {}, ["other-day", "fake-slot"]),
          // A date that was never looked up and a slot id that does not exist.
          el("other-day", "SlotPicker", { date: "2030-01-12" }),
          el("fake-slot", "SlotOption", { slotId: "99999999-2222-4333-8444-000000000000" }),
        ),
        { type: "finish" },
      ],
    ]);
    await user.type(input(), "Saturday?{Enter}");
    await screen.findByTestId("generated-ui");
    expect(within(ui()).getByText("Times for this day haven’t been looked up.")).toBeInTheDocument();
    expect(within(ui()).getByText("This appointment is no longer shown as free.")).toBeInTheDocument();
    expect(within(ui()).queryAllByRole("button")).toEqual([]);
  });

  it("refuses a malicious spec even if it reaches the browser unvalidated", async () => {
    const { user, input, requests } = setup([
      [
        { type: "start", messageId: "a1" },
        ...slotsFound(),
        ...text("t", "Click to confirm."),
        ...spec(
          root("main"),
          el("main", "Card", {}, ["confirm", "times"]),
          el("confirm", "ActionButton", { label: "Confirm booking" }, [], {
            on: { press: { action: "approveBooking", params: { slotId: S1630 } } },
          }),
          el("times", "SlotPicker", { date: "2030-01-10" }),
        ),
        { type: "finish" },
      ],
    ]);
    await user.type(input(), "Book it{Enter}");
    await screen.findByText("Click to confirm.");
    // The approve button is rejected client-side; the incomplete tree renders nothing.
    expect(screen.queryByRole("button", { name: "Confirm booking" })).toBeNull();
    expect(screen.queryByTestId("generated-ui")).toBeNull();
    expect(screen.getByText("Part of this reply couldn’t be displayed.")).toBeInTheDocument();
    // The deterministic fallback keeps the found times usable.
    expect(screen.getByRole("list", { name: "Free times on Thursday 10 January 2030" })).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("ignores a selectSlot action for a slot that no tool returned", async () => {
    const { user, input, requests } = setup([
      [
        { type: "start", messageId: "a1" },
        ...slotsFound(),
        ...text("t", "Book this:"),
        ...spec(
          root("b"),
          el("b", "ActionButton", { label: "Take it" }, [], {
            on: { press: { action: "selectSlot", params: { slotId: "99999999-2222-4333-8444-000000000000" } } },
          }),
        ),
        { type: "finish" },
      ],
    ]);
    await user.type(input(), "Anything?{Enter}");
    await user.click(await screen.findByRole("button", { name: "Take it" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown slot"));
  });

  it("renders a partial spec progressively while it streams", async () => {
    let live!: ManualStream;
    const { user, input } = setup([(s) => (live = s)]);
    await user.type(input(), "Thursday?{Enter}");
    live.push({ type: "start", messageId: "a1" }, ...slotsFound(), ...text("t", "Loading the times:"));
    live.push(...spec(root("main"), el("main", "Card", { title: "Thursday" }, ["times"])));
    expect(await screen.findByText("Thursday")).toBeInTheDocument();
    expect(ui()).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: /Select/ })).toBeNull();

    live.push(...spec(el("times", "SlotPicker", { date: "2030-01-10" })), { type: "finish" });
    live.close();
    expect(await screen.findByRole("button", { name: /Select 14:00/ })).toBeInTheDocument();
    await waitFor(() => expect(ui()).toHaveAttribute("aria-busy", "false"));
  });

  it("shows bookings from this conversation as a list, with an empty state", async () => {
    const booking = {
      reference: "3F9A12BC",
      serviceName: "Initial Physiotherapy Consultation",
      providerName: "Eva Physio",
      date: "2030-01-10",
      dateLabel: "Thursday 10 January 2030",
      startTime: "16:30",
      endTime: "17:00",
      timeZone: "Europe/Prague",
      guestName: "Jana",
      status: "confirmed",
    };
    const { user, input } = setup([
      [
        { type: "start", messageId: "a1" },
        { type: "tool-input-available", toolCallId: "l1", toolName: "listMyBookings", input: {} },
        { type: "tool-output-available", toolCallId: "l1", output: { status: "none", message: "No bookings." } },
        ...text("t", "No bookings yet."),
        ...spec(root("list"), el("list", "BookingList", {})),
        { type: "finish" },
      ],
      [
        { type: "start", messageId: "a2" },
        { type: "tool-input-available", toolCallId: "l2", toolName: "listMyBookings", input: {} },
        { type: "tool-output-available", toolCallId: "l2", output: { status: "ok", bookings: [booking] } },
        ...text("t", "Here they are."),
        ...spec(root("list"), el("list", "BookingList", { title: "Your bookings" })),
        { type: "finish" },
      ],
    ]);
    await user.type(input(), "Show my bookings{Enter}");
    expect(await screen.findByText("No bookings in this conversation yet.")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    await user.type(input(), "And now?{Enter}");
    const list = await screen.findByRole("list", { name: "Your bookings" });
    expect(list).toHaveTextContent("3F9A12BC");
    expect(list).toHaveTextContent("16:30–17:00");
    expect(list).toHaveTextContent("Confirmed");
  });

  it("states an empty bookings result even when the model shows unrelated UI", async () => {
    const { user, input } = setup([
      [
        { type: "start", messageId: "a1" },
        ...slotsFound(),
        { type: "tool-input-available", toolCallId: "l1", toolName: "listMyBookings", input: {} },
        { type: "tool-output-available", toolCallId: "l1", output: { status: "none", message: "No bookings." } },
        ...text("t", "Nothing yet; here are Thursday's times again."),
        ...spec(root("t"), el("t", "SlotPicker", { date: "2030-01-10" })),
        { type: "finish" },
      ],
    ]);
    await user.type(input(), "Show all my bookings{Enter}");
    expect(await screen.findByText("No bookings in this conversation yet")).toBeInTheDocument();
  });

  it("keeps text-only replies free of generated UI", async () => {
    const { user, input } = setup([[{ type: "start", messageId: "a1" }, ...text("t", "A consultation is a first assessment."), { type: "finish" }]]);
    await user.type(input(), "What's a consultation?{Enter}");
    expect(await screen.findByText("A consultation is a first assessment.")).toBeInTheDocument();
    expect(screen.queryByTestId("generated-ui")).toBeNull();
  });
});
