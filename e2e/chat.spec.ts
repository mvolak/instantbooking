import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser-level checks of the chat UI. `/api/chat` is answered by a scripted UI
 * message stream so the run is deterministic and never calls a paid model; the
 * agent itself is covered by the Vitest integration suite.
 */

const sse = (chunks: object[]) =>
  [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");

const REVIEW = {
  serviceName: "Initial Physiotherapy Consultation",
  providerName: "Motion Studio",
  date: "2026-11-12",
  dateLabel: "Thursday 12 November 2026",
  startTime: "16:30",
  endTime: "17:00",
  timeZone: "Europe/Prague",
};

const text = (id: string, value: string) => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: value },
  { type: "text-end", id },
];

async function scriptChat(page: Page, replies: object[][]) {
  const bodies: unknown[] = [];
  await page.route("**/api/chat", async (route: Route) => {
    bodies.push(route.request().postDataJSON());
    const chunks = replies[bodies.length - 1] ?? [{ type: "error", errorText: "unexpected request" }];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: sse(chunks),
    });
  });
  return bodies;
}

test.describe("chat booking", () => {
  test("reviews and confirms a booking in the chat panel", async ({ page }) => {
    const requests = await scriptChat(page, [
      [
        { type: "start", messageId: "a1" },
        ...text("t1", "Here is the booking, please confirm."),
        {
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "createBooking",
          input: { slotId: "s1", guestName: "E2E Chat Guest", review: REVIEW },
        },
        { type: "tool-approval-request", toolCallId: "call-1", approvalId: "ap-1" },
        { type: "finish" },
      ],
      [
        { type: "start", messageId: "a1" },
        {
          type: "tool-output-available",
          toolCallId: "call-1",
          output: {
            status: "confirmed",
            access: "SEALED-E2E",
            booking: { ...REVIEW, reference: "3F9A12BC", guestName: "E2E Chat Guest", status: "confirmed" },
          },
        },
        ...text("t2", "You're booked!"),
        { type: "finish" },
      ],
    ]);

    await page.goto("/#chat");
    const chat = page.getByRole("region", { name: "Prefer to just ask?" });
    await chat.getByLabel("Message the booking assistant").fill("Book Thursday 16:30 for E2E Chat Guest");
    await chat.getByRole("button", { name: "Send" }).click();

    const review = page.getByTestId("booking-review");
    await expect(review).toContainText("Thursday 12 November 2026");
    await expect(review).toContainText("16:30–17:00 (Prague time)");
    await review.getByRole("button", { name: "Confirm booking" }).click();

    const confirmation = page.getByTestId("chat-booking-confirmation");
    await expect(confirmation).toContainText("3F9A12BC");
    await expect(confirmation).toContainText("Confirmed");
    expect(requests).toHaveLength(2);
    expect(await page.content()).not.toContain("SEALED-E2E");

    // The classic booking widget is still there and working alongside the chat.
    await expect(page.getByRole("region", { name: "Book an appointment" }).getByRole("group", { name: /^Time/ })).toBeVisible();
  });

  test("tells the visitor when the assistant is unavailable", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "CHAT_UNAVAILABLE", message: "The booking assistant is not available right now. Please use the booking form." },
        }),
      }),
    );
    await page.goto("/#chat");
    await page.getByRole("button", { name: "When is the next free appointment?" }).click();
    await expect(page.getByRole("log", { name: /conversation/i }).getByRole("alert")).toContainText("Please use the booking form.");
  });
});
