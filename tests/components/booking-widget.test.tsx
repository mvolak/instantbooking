// @vitest-environment jsdom
import "./setup";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BookingWidget } from "@/components/booking/BookingWidget";
import { bookingFor, createFakeApi, deferred, json, SERVICE, slot, TOKEN } from "./fake-api";

const THU = "2026-11-12";
const FRI = "2026-11-13";

function setup(options: Parameters<typeof createFakeApi>[0] = {}, keys?: string[]) {
  const api = createFakeApi({
    days: ["2026-11-10", "2026-11-11", THU, FRI, "2026-11-14"],
    slots: {
      [THU]: [slot(THU, "09:00"), slot(THU, "09:30"), slot(THU, "14:00")],
      [FRI]: [slot(FRI, "10:00"), slot(FRI, "10:30")],
    },
    ...options,
  });
  let n = 0;
  const generateKey = () => keys?.[n++] ?? `key-${++n}`;
  const user = userEvent.setup();
  const view = render(<BookingWidget client={api.client} generateKey={generateKey} />);
  return { api, user, ...view };
}

const timeButton = (time: string) => screen.findByRole("button", { name: new RegExp(`^${time} to`) });
const dateButton = (label: RegExp) => screen.getByRole("button", { name: label });
const submitButton = () => screen.getByRole("button", { name: /^Book |Choose a time|Booking/ });

async function chooseTimeAndName(user: ReturnType<typeof userEvent.setup>, time = "09:00", name = "Jana Nováková") {
  await user.click(await timeButton(time));
  await user.type(screen.getByLabelText("Your name"), name);
}

describe("BookingWidget", () => {
  describe("service content", () => {
    it("shows a loading state, then the service from the API with its duration", async () => {
      setup();
      expect(screen.getByRole("status")).toHaveTextContent("Loading services…");
      expect(await screen.findByText(SERVICE.name)).toBeInTheDocument();
      expect(screen.getByText(SERVICE.description)).toBeInTheDocument();
      expect(screen.getByText("30 min")).toBeInTheDocument();
    });

    it("shows an actionable error when services fail to load, and recovers on retry", async () => {
      const api = createFakeApi({ days: [THU], slots: { [THU]: [slot(THU, "09:00")] } });
      api.once("GET /api/services", () => Promise.reject(new TypeError("Failed to fetch")));
      const user = userEvent.setup();
      render(<BookingWidget client={api.client} />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("couldn’t load our services");
      expect(alert).toHaveTextContent("check your connection");
      await user.click(within(alert).getByRole("button", { name: /try again/i }));
      expect(await screen.findByText(SERVICE.name)).toBeInTheDocument();
    });
  });

  describe("date selection", () => {
    it("defaults to the first date with availability and disables full days", async () => {
      setup();
      const thursday = await screen.findByRole("button", { name: /Thursday,? 12 November 2026, 3 times available/ });
      expect(thursday).toHaveAttribute("aria-pressed", "true");
      expect(dateButton(/Tuesday,? 10 November 2026, no times available/)).toBeDisabled();
      expect(dateButton(/Saturday,? 14 November 2026, no times available/)).toBeDisabled();
      expect(dateButton(/Friday,? 13 November 2026, 2 times available/)).toBeEnabled();
    });

    it("loads the times for a newly selected date", async () => {
      const { api, user } = setup();
      await timeButton("09:00");
      await user.click(dateButton(/Friday,? 13 November/));

      expect(dateButton(/Friday,? 13 November/)).toHaveAttribute("aria-pressed", "true");
      expect(await timeButton("10:00")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^09:00 to/ })).not.toBeInTheDocument();
      expect(api.callsTo("GET /api/slots").map((c) => c.query.get("date"))).toEqual([THU, FRI]);
    });

    it("ignores a slow response for a previously selected date (no stale overwrite)", async () => {
      const api = createFakeApi({
        days: [THU, FRI],
        slots: { [THU]: [slot(THU, "09:00")], [FRI]: [slot(FRI, "10:00")] },
      });
      const slowThursday = deferred<Response>();
      api.once("GET /api/slots", () => slowThursday.promise); // first (Thursday) request hangs
      const user = userEvent.setup();
      render(<BookingWidget client={api.client} />);

      await user.click(await screen.findByRole("button", { name: /Friday,? 13 November/ }));
      expect(await timeButton("10:00")).toBeInTheDocument();

      slowThursday.resolve(json(200, { data: [slot(THU, "09:00")] }));
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByRole("button", { name: /^10:00 to/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^09:00 to/ })).not.toBeInTheDocument();
    });
  });

  describe("available slots", () => {
    it("renders times in the provider's local time with a timezone note", async () => {
      setup();
      // 09:00 Prague (CET) is 08:00 UTC; the UI must show local wall-clock time.
      const nine = await timeButton("09:00");
      expect(nine).toHaveTextContent("09:00");
      expect(nine).toHaveAccessibleName("09:00 to 09:30 with Motion Studio");
      expect(screen.queryByText("08:00")).not.toBeInTheDocument();
      expect(screen.getByText("Times shown in Prague time (Europe/Prague).")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: / to \d\d:\d\d with/ })).toHaveLength(3);
    });

    it("selects a time and reflects it in the submit button", async () => {
      const { user } = setup();
      await timeButton("14:00");
      expect(submitButton()).toBeDisabled();
      expect(submitButton()).toHaveTextContent("Choose a time to continue");
      await user.click(await timeButton("14:00"));
      expect(await timeButton("14:00")).toHaveAttribute("aria-pressed", "true");
      expect(submitButton()).toHaveTextContent("Book Thu 12 Nov at 14:00");
      expect(submitButton()).toBeEnabled();
    });

    it("shows retryable errors when times fail to load", async () => {
      const api = createFakeApi({ days: [THU], slots: { [THU]: [slot(THU, "09:00")] } });
      api.once("GET /api/slots", () => json(500, { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }));
      const user = userEvent.setup();
      render(<BookingWidget client={api.client} />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("couldn’t load available times. Something went wrong on our side");
      await user.click(within(alert).getByRole("button", { name: /try again/i }));
      expect(await timeButton("09:00")).toBeInTheDocument();
    });
  });

  describe("empty availability", () => {
    it("explains when there is nothing to book in the window", async () => {
      setup({ days: ["2026-11-10", "2026-11-11"], slots: {} });
      expect(await screen.findByText(/No free appointments in the next 14 days/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: / to \d\d:\d\d with/ })).not.toBeInTheDocument();
      expect(submitButton()).toBeDisabled();
    });

    it("handles a day whose last times were taken after the calendar loaded", async () => {
      const api = createFakeApi({ days: [THU], slots: { [THU]: [slot(THU, "09:00")] } });
      api.once("GET /api/slots", () => json(200, { data: [] }));
      render(<BookingWidget client={api.client} />);
      expect(await screen.findByText("No times left on this day. Please choose another date.")).toBeInTheDocument();
    });
  });

  describe("guest name validation", () => {
    it("requires a name before submitting, without calling the API", async () => {
      const { api, user } = setup();
      await user.click(await timeButton("09:00"));
      await user.type(screen.getByLabelText("Your name"), "   ");
      await user.click(submitButton());

      const input = screen.getByLabelText("Your name");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription("Please enter your name");
      expect(api.callsTo("POST /api/bookings")).toHaveLength(0);

      await user.type(input, "Jana");
      expect(input).not.toHaveAttribute("aria-invalid");
    });

    it("shows server-side validation errors on the field", async () => {
      const { api, user } = setup();
      api.once("POST /api/bookings", () =>
        json(400, {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid input",
            details: [{ path: "guestName", message: "Name must be at most 100 characters" }],
          },
        }),
      );
      await chooseTimeAndName(user);
      await user.click(submitButton());
      expect(await screen.findByText("Name must be at most 100 characters")).toBeInTheDocument();
      expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("booking", () => {
    it("books through the API and shows the confirmation", async () => {
      const { api, user } = setup({}, ["attempt-key-1"]);
      await chooseTimeAndName(user, "09:30", "  Jana Nováková ");
      await user.click(submitButton());

      expect(await screen.findByRole("heading", { name: "You’re booked!" })).toBeInTheDocument();
      const [post] = api.callsTo("POST /api/bookings");
      expect(post.body).toEqual({ slotId: `slot-${THU}-09:30`, guestName: "Jana Nováková" });
      expect(post.headers.get("idempotency-key")).toBe("attempt-key-1");
    });

    it("never renders or stores the management token", async () => {
      const { user, container } = setup();
      await chooseTimeAndName(user);
      await user.click(submitButton());
      await screen.findByTestId("booking-confirmation");

      expect(container.innerHTML).not.toContain(TOKEN);
      expect(document.body.innerHTML).not.toContain(TOKEN);
      expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
      expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
      expect(window.location.href).not.toContain(TOKEN);
    });

    it("prevents duplicate submissions while a booking is in progress", async () => {
      const { api, user } = setup();
      const pending = deferred<Response>();
      api.once("POST /api/bookings", () => pending.promise);
      await chooseTimeAndName(user);

      await user.click(submitButton());
      await user.click(submitButton());
      await user.keyboard("{Enter}");
      expect(submitButton()).toBeDisabled();
      expect(submitButton()).toHaveTextContent("Booking…");
      expect(api.callsTo("POST /api/bookings")).toHaveLength(1);

      pending.resolve(json(201, { data: { booking: bookingFor(slot(THU, "09:00"), "Jana Nováková"), managementToken: TOKEN } }));
      expect(await screen.findByTestId("booking-confirmation")).toBeInTheDocument();
      expect(api.callsTo("POST /api/bookings")).toHaveLength(1);
    });

    it("reuses the idempotency key when retrying after a network failure", async () => {
      const { api, user } = setup({}, ["first-key", "second-key"]);
      api.once("POST /api/bookings", () => Promise.reject(new TypeError("Failed to fetch")));
      await chooseTimeAndName(user);

      await user.click(submitButton());
      expect(await screen.findByRole("alert")).toHaveTextContent("you won’t be booked twice");

      await user.click(submitButton());
      await screen.findByTestId("booking-confirmation");
      expect(api.callsTo("POST /api/bookings").map((c) => c.headers.get("idempotency-key"))).toEqual([
        "first-key",
        "first-key",
      ]);
    });

    it("uses a new idempotency key when the attempt changes", async () => {
      const { api, user } = setup({}, ["first-key", "second-key"]);
      api.once("POST /api/bookings", () => json(500, { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }));
      await chooseTimeAndName(user);
      await user.click(submitButton());
      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side");

      await user.click(await timeButton("14:00")); // different slot → different attempt
      await user.click(submitButton());
      await screen.findByTestId("booking-confirmation");
      expect(api.callsTo("POST /api/bookings").map((c) => c.headers.get("idempotency-key"))).toEqual([
        "first-key",
        "second-key",
      ]);
    });

    it("handles a conflict: explains, refreshes availability and keeps the name", async () => {
      const { api, user } = setup();
      await chooseTimeAndName(user, "09:00", "Jana");
      api.takeSlot(`slot-${THU}-09:00`); // someone else books it meanwhile
      const slotRequestsBefore = api.callsTo("GET /api/slots").length;

      await user.click(submitButton());

      expect(await screen.findByRole("status")).toHaveTextContent("that time was just booked by someone else");
      await waitFor(() => expect(api.callsTo("GET /api/slots").length).toBeGreaterThan(slotRequestsBefore));
      await waitFor(() => expect(screen.queryByRole("button", { name: /^09:00 to/ })).not.toBeInTheDocument());
      expect(await timeButton("09:30")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByLabelText("Your name")).toHaveValue("Jana");
      expect(submitButton()).toBeDisabled(); // must pick a new time
      expect(screen.queryByTestId("booking-confirmation")).not.toBeInTheDocument();
    });

    it("moves to the next available date if the conflict emptied the selected day", async () => {
      const api = createFakeApi({ days: [THU, FRI], slots: { [THU]: [slot(THU, "09:00")], [FRI]: [slot(FRI, "10:00")] } });
      const user = userEvent.setup();
      render(<BookingWidget client={api.client} />);
      await chooseTimeAndName(user);
      api.takeSlot(`slot-${THU}-09:00`);
      await user.click(submitButton());

      expect(await screen.findByRole("status")).toHaveTextContent("just booked by someone else");
      expect(await timeButton("10:00")).toBeInTheDocument();
      expect(dateButton(/Friday,? 13 November/)).toHaveAttribute("aria-pressed", "true");
      expect(dateButton(/Thursday,? 12 November 2026, no times available/)).toBeDisabled();
    });
  });

  describe("confirmation", () => {
    it("shows the details returned by the server, not the client's guesses", async () => {
      const { api, user } = setup();
      const serverBooking = {
        ...bookingFor(slot(THU, "09:00"), "Jana Nováková"),
        id: "abcdef12-3456-4789-8abc-def012345678",
        providerName: "Motion Studio Vinohrady",
      };
      api.once("POST /api/bookings", () => json(201, { data: { booking: serverBooking, managementToken: TOKEN } }));
      await chooseTimeAndName(user, "09:00", "jana nováková");
      await user.click(submitButton());

      const confirmation = await screen.findByTestId("booking-confirmation");
      const detail = (label: string) => within(confirmation).getByText(label).nextElementSibling;
      expect(within(confirmation).getByText("Confirmed")).toBeInTheDocument();
      expect(detail("Reference")).toHaveTextContent("ABCDEF12");
      expect(detail("Service")).toHaveTextContent("Initial Physiotherapy Consultation");
      expect(detail("Date")).toHaveTextContent(/Thursday,? 12 November 2026/);
      expect(detail("Time")).toHaveTextContent("09:00–09:30 (Prague time)");
      expect(detail("With")).toHaveTextContent("Motion Studio Vinohrady");
      expect(detail("Name")).toHaveTextContent("Jana Nováková"); // server's value
    });

    it("lets the user start another booking with refreshed availability", async () => {
      const { api, user } = setup();
      await chooseTimeAndName(user);
      await user.click(submitButton());
      await screen.findByTestId("booking-confirmation");

      await user.click(screen.getByRole("button", { name: "Book another appointment" }));
      expect(await timeButton("09:30")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^09:00 to/ })).not.toBeInTheDocument(); // just booked
      expect(screen.getByLabelText("Your name")).toHaveValue("");
      expect(api.callsTo("GET /api/availability").length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("accessibility", () => {
    it("can be completed with the keyboard alone, and focuses the confirmation", async () => {
      const { user } = setup();
      const nine = await timeButton("09:00");
      nine.focus();
      await user.keyboard("{Enter}");
      expect(nine).toHaveAttribute("aria-pressed", "true");

      screen.getByLabelText("Your name").focus();
      await user.keyboard("Jana{Enter}");

      const heading = await screen.findByRole("heading", { name: "You’re booked!" });
      await waitFor(() => expect(heading).toHaveFocus());
    });

    it("labels its regions, steps and controls", async () => {
      setup();
      await timeButton("09:00");
      expect(screen.getByRole("region", { name: "Book an appointment" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Date" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: /^Time/ })).toBeInTheDocument();
      expect(screen.getByRole("form", { name: "Your details" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Your name" })).toHaveAttribute("autocomplete", "name");
      for (const button of screen.getAllByRole("button")) {
        expect(button).toHaveAccessibleName();
      }
    });
  });
});
