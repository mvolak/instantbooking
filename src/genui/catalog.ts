import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * The generative UI vocabulary: what the agent may compose, independent of
 * any renderer. Layout primitives carry free prose; booking components only
 * carry *references* (a date, a slot id, a booking reference) that the
 * renderer resolves against authoritative tool results in the conversation.
 * The model therefore chooses structure and emphasis, never the facts.
 *
 * There is deliberately no component or action that approves, cancels or
 * creates a booking: approval stays bound to the signed createBooking tool
 * call (see `src/ai/booking-tools.ts`).
 */

const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const slotId = z.guid();
const reference = z.string().regex(/^[A-Za-z0-9]{8}$/);
const shortText = (max: number) => z.string().min(1).max(max);

export const componentProps = {
  Stack: z.strictObject({
    direction: z.enum(["vertical", "horizontal"]).optional(),
    gap: z.enum(["sm", "md", "lg"]).optional(),
  }),
  Card: z.strictObject({
    title: shortText(80).optional(),
    description: shortText(240).optional(),
    tone: z.enum(["default", "highlight", "muted"]).optional(),
  }),
  Text: z.strictObject({
    text: shortText(600),
    variant: z.enum(["body", "muted", "heading", "label"]).optional(),
  }),
  Divider: z.strictObject({}),
  ServiceSummary: z.strictObject({
    serviceId: slotId,
    showDescription: z.boolean().optional(),
  }),
  DayOverview: z.strictObject({
    title: shortText(80).optional(),
    limit: z.number().int().min(1).max(14).optional(),
  }),
  SlotPicker: z.strictObject({
    date: isoDate,
    from: hhmm.optional(),
    to: hhmm.optional(),
    title: shortText(80).optional(),
    layout: z.enum(["grid", "list"]).optional(),
    limit: z.number().int().min(1).max(24).optional(),
  }),
  SlotOption: z.strictObject({
    slotId,
    note: shortText(120).optional(),
  }),
  BookingDetails: z.strictObject({
    reference,
  }),
  BookingList: z.strictObject({
    title: shortText(80).optional(),
    references: z.array(reference).max(10).optional(),
  }),
  ActionButton: z.strictObject({
    label: shortText(40),
    variant: z.enum(["primary", "secondary"]).optional(),
  }),
} as const;

export const actionParams = {
  selectSlot: z.strictObject({ slotId }),
  showDay: z.strictObject({ date: isoDate }),
  sendMessage: z.strictObject({ text: shortText(160) }),
} as const;

export type ComponentName = keyof typeof componentProps;
export type ActionName = keyof typeof actionParams;

/** Components that may have children. */
export const CONTAINERS: ReadonlySet<ComponentName> = new Set(["Stack", "Card"]);
/** Components that may carry an `on.press` action binding. */
export const ACTIONABLE: ReadonlySet<ComponentName> = new Set(["ActionButton"]);

export const bookingCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: componentProps.Stack,
      description: "Layout container that stacks its children vertically (default) or horizontally.",
    },
    Card: {
      props: componentProps.Card,
      description: "Bordered card with optional title and description; groups related content. tone=highlight for the main recommendation.",
    },
    Text: {
      props: componentProps.Text,
      description: "A short plain-text paragraph. Never put appointment times, dates, references or prices you did not get from a tool here.",
    },
    Divider: { props: componentProps.Divider, description: "Thin horizontal separator." },
    ServiceSummary: {
      props: componentProps.ServiceSummary,
      description: "Shows a service's name, duration and (optionally) description, resolved from a listServices result by serviceId.",
    },
    DayOverview: {
      props: componentProps.DayOverview,
      description: "Upcoming days with their number of free appointments, from the latest findAvailableDates result. Each day is a button that asks for that day's times.",
    },
    SlotPicker: {
      props: componentProps.SlotPicker,
      description: "Selectable free appointment times for one date (YYYY-MM-DD), resolved from findAvailableSlots results for that date. Optional from/to (HH:MM) narrow the shown times. Each time is a button that selects that exact slot.",
    },
    SlotOption: {
      props: componentProps.SlotOption,
      description: "One appointment shown prominently with a Select button, resolved by its slotId from a findAvailableSlots result. Good for a single result or a recommendation.",
    },
    BookingDetails: {
      props: componentProps.BookingDetails,
      description: "Details and status of one booking made in this conversation, by its 8-character reference.",
    },
    BookingList: {
      props: componentProps.BookingList,
      description: "List of bookings made in this conversation (all of them, or only the given references), with status. Shows an empty state if there are none.",
    },
    ActionButton: {
      props: componentProps.ActionButton,
      description: "A button that runs one allowed action via on.press: showDay {date} asks for that day's times; sendMessage {text} sends a short follow-up as the guest; selectSlot {slotId} picks a slot.",
    },
  },
  actions: {
    selectSlot: {
      params: actionParams.selectSlot,
      description: "Select an appointment slot (slotId from a findAvailableSlots result). The assistant then prepares the booking for the guest to confirm.",
    },
    showDay: {
      params: actionParams.showDay,
      description: "Ask for the free times on a date (YYYY-MM-DD).",
    },
    sendMessage: {
      params: actionParams.sendMessage,
      description: "Send a short follow-up message as the guest, e.g. 'Show me Friday instead'.",
    },
  },
});
