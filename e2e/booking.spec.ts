import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Slot = { id: string; startsAtLocal: string };
type Day = { date: string; availableSlots: number };

const SERVICE_NAME = "Initial Physiotherapy Consultation";

/** The service id, first bookable date and its slots, straight from the API. */
async function availability(request: APIRequestContext) {
  const services = (await (await request.get("/api/services")).json()).data as { id: string; name: string }[];
  const service = services.find((s) => s.name === SERVICE_NAME);
  expect(service, "seeded service exists — run `npm run db:seed:demo`").toBeTruthy();
  const days = (await (await request.get(`/api/availability?serviceId=${service!.id}`)).json()).data as Day[];
  const day = days.find((d) => d.availableSlots > 0);
  expect(day, "upcoming availability exists — run `npm run db:seed:demo`").toBeTruthy();
  const slots = (await (await request.get(`/api/slots?serviceId=${service!.id}&date=${day!.date}`)).json()).data as Slot[];
  return { serviceId: service!.id, date: day!.date, slots };
}

const hhmm = (slot: Slot) => slot.startsAtLocal.slice(11, 16);
const timeButton = (page: Page, time: string) => page.getByRole("button", { name: new RegExp(`^${time} to`) });

test.describe("landing page booking", () => {
  test("shows the studio and live service data", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Motion Studio/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Move better\.\s*Feel better\./);
    const widget = page.getByRole("region", { name: "Book an appointment" });
    await expect(widget.getByText(SERVICE_NAME)).toBeVisible();
    await expect(widget.getByText("30 min")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("books an appointment end to end and the slot disappears", async ({ page, request }) => {
    const { serviceId, date, slots } = await availability(request);
    const target = slots[0];

    await page.goto("/");
    await timeButton(page, hhmm(target)).click();
    await page.getByLabel("Your name").fill("E2E Guest");

    const bookingResponse = page.waitForResponse((r) => r.url().endsWith("/api/bookings") && r.request().method() === "POST");
    await page.getByRole("button", { name: new RegExp(`^Book .* at ${hhmm(target)}$`) }).click();
    const created = (await (await bookingResponse).json()).data;

    const confirmation = page.getByTestId("booking-confirmation");
    await expect(confirmation.getByRole("heading", { name: "You’re booked!" })).toBeVisible();
    await expect(confirmation).toContainText(created.booking.id.replaceAll("-", "").slice(0, 8).toUpperCase());
    await expect(confirmation).toContainText(SERVICE_NAME);
    await expect(confirmation).toContainText(`${hhmm(target)}–`);
    await expect(confirmation).toContainText("Motion Studio");
    expect(created.booking.slotId).toBe(target.id);

    // The token never reaches the URL or browser storage.
    expect(page.url()).not.toContain(created.managementToken);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain(created.managementToken);
    expect(await page.content()).not.toContain(created.managementToken);

    // The booked slot is gone from the real API and from the UI.
    const after = (await (await request.get(`/api/slots?serviceId=${serviceId}&date=${date}`)).json()).data as Slot[];
    expect(after.map((s) => s.id)).not.toContain(target.id);
    await page.getByRole("button", { name: "Book another appointment" }).click();
    await expect(page.getByRole("group", { name: /^Time/ })).toBeVisible();
    // If that was the day's last free time the widget moves on to the next day,
    // where the same clock time may legitimately exist; only check the same day.
    if (after.length > 0) {
      await expect(timeButton(page, hhmm(after[0]))).toBeVisible();
      await expect(timeButton(page, hhmm(target))).toHaveCount(0);
    }
  });

  test("handles a slot taken by someone else before submitting", async ({ page, request }) => {
    const { slots } = await availability(request);
    const target = slots[0];

    await page.goto("/");
    await timeButton(page, hhmm(target)).click();
    await page.getByLabel("Your name").fill("E2E Second Guest");

    // Another visitor books the same slot through the API first.
    const rival = await request.post("/api/bookings", {
      headers: { "Idempotency-Key": randomUUID() },
      data: { slotId: target.id, guestName: "E2E Rival" },
    });
    expect(rival.status()).toBe(201);

    await page.getByRole("button", { name: new RegExp(`^Book .* at ${hhmm(target)}$`) }).click();
    await expect(page.getByRole("status").filter({ hasText: "just booked by someone else" })).toBeVisible();
    await expect(timeButton(page, hhmm(target))).toHaveCount(0);
    await expect(page.getByTestId("booking-confirmation")).toHaveCount(0);
    await expect(page.getByLabel("Your name")).toHaveValue("E2E Second Guest");
  });

  test("fits the viewport without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("group", { name: /^Time/ })).toBeVisible();
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll("header, main, section, footer")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => el.id || el.tagName),
    );
    expect(overflowing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Interactive targets are comfortably tappable.
    const box = await page.getByRole("button", { name: / to \d\d:\d\d with/ }).first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});
