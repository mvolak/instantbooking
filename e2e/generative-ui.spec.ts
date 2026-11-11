import { expect, test, type Page } from "@playwright/test";

/**
 * Browser-level checks of generated UI in the chat (M4). `/api/chat` answers
 * with the exact chunk sequence the server produces (text + validated
 * data-spec patches), so the run is deterministic and never calls a model.
 */

const S1400 = "11111111-2222-4333-8444-000000001400";
const S1630 = "11111111-2222-4333-8444-000000001630";
const F1000 = "11111111-2222-4333-8444-000000011000";

const sse = (chunks: object[]) => [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
const text = (id: string, value: string) => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: value },
  { type: "text-end", id },
];
const patch = (p: object) => ({ type: "data-spec", data: { type: "patch", patch: p } });
const el = (key: string, type: string, props: object = {}, children: string[] = [], extra: object = {}) =>
  patch({ op: "add", path: `/elements/${key}`, value: { type, props, children, ...extra } });

const slotsResult = (id: string, date: string, dateLabel: string, slots: [string, string, string][]) => [
  { type: "tool-input-available", toolCallId: id, toolName: "findAvailableSlots", input: { serviceId: "svc", date } },
  {
    type: "tool-output-available",
    toolCallId: id,
    output: {
      status: "ok",
      date,
      dateLabel,
      weekday: dateLabel.split(" ")[0],
      timeZone: "Europe/Prague",
      slots: slots.map(([slotId, startTime, endTime]) => ({
        slotId,
        startTime,
        endTime,
        startsAtUtc: "",
        providerName: "Motion Studio",
        providerTimezone: "Europe/Prague",
      })),
    },
  },
];

const comparison = [
  { type: "start", messageId: "a1" },
  ...slotsResult("c1", "2030-01-10", "Thursday 10 January 2030", [
    [S1400, "14:00", "14:30"],
    [S1630, "16:30", "17:00"],
  ]),
  ...slotsResult("c2", "2030-01-11", "Friday 11 January 2030", [[F1000, "10:00", "10:30"]]),
  ...text("t1", "Here are both days side by side."),
  patch({ op: "add", path: "/root", value: "cmp" }),
  el("cmp", "Stack", { direction: "horizontal" }, ["thu", "fri"]),
  el("thu", "Card", { title: "Thursday" }, ["thu-times"]),
  el("thu-times", "SlotPicker", { date: "2030-01-10", layout: "list" }),
  el("fri", "Card", { title: "Friday", tone: "highlight" }, ["fri-best"]),
  el("fri-best", "SlotOption", { slotId: F1000, note: "The only free time on Friday." }),
  { type: "finish" },
];

async function scriptChat(page: Page, replies: object[][]) {
  const bodies: { messages: { parts: unknown[] }[] }[] = [];
  await page.route("**/api/chat", async (route) => {
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

test.describe("generative UI in the chat", () => {
  test("composes a comparison and selects a slot by its id", async ({ page }) => {
    const requests = await scriptChat(page, [comparison, [{ type: "start", messageId: "a2" }, ...text("t2", "What name should I use?"), { type: "finish" }]]);
    await page.goto("/#chat");
    const chat = page.getByRole("region", { name: "Prefer to just ask?" });
    await chat.getByLabel("Message the booking assistant").fill("Compare Thursday and Friday");
    await chat.getByRole("button", { name: "Send" }).click();

    const ui = chat.getByTestId("generated-ui");
    await expect(ui.getByRole("list", { name: "Free times on Thursday 10 January 2030" })).toBeVisible();
    await expect(ui.getByText("The only free time on Friday.")).toBeVisible();

    // No horizontal overflow on this viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await ui.getByRole("button", { name: /Select 10:00–10:30 on Friday 11 January 2030/ }).click();
    await expect(chat.getByText("What name should I use?")).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)!.parts).toEqual([
      { type: "text", text: "I'd like the 10:00 appointment on Friday 11 January 2030." },
      { type: "data-slotSelection", data: { slotId: F1000 } },
    ]);
  });

  test("is operable with the keyboard", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    const requests = await scriptChat(page, [comparison, [{ type: "start", messageId: "a2" }, ...text("t2", "Name?"), { type: "finish" }]]);
    await page.goto("/#chat");
    const input = page.getByLabel("Message the booking assistant");
    await input.fill("Compare Thursday and Friday");
    await input.press("Enter");

    const first = page.getByRole("button", { name: /Select 14:00–14:30/ });
    await expect(first).toBeVisible();
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /Select 16:30–17:00/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Name?")).toBeVisible();
    expect(requests[1].messages.at(-1)!.parts).toContainEqual({ type: "data-slotSelection", data: { slotId: S1630 } });
  });
});
