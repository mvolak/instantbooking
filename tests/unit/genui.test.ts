import { describe, expect, it, vi } from "vitest";
import { runAction } from "@/genui/actions";
import type { BookingData, SlotView } from "@/genui/booking-data";
import { GENERATIVE_UI_INSTRUCTIONS } from "@/genui/prompt";
import { coalesceTextDeltas, withGenerativeUI } from "@/genui/stream";
import { checkElement, checkPatch, checkSpec, MAX_ELEMENTS, specSegments, type GenSpec } from "@/genui/validation";

const SLOT = "11111111-2222-4333-8444-555555555555";
const el = (type: string, props: Record<string, unknown> = {}, children: string[] = [], extra = {}) => ({
  type,
  props,
  children,
  ...extra,
});

describe("generated UI validation", () => {
  it("accepts catalog components with valid props", () => {
    expect(checkElement(el("Card", { title: "Thursday", tone: "highlight" }, ["a"])).ok).toBe(true);
    expect(checkElement(el("SlotPicker", { date: "2030-01-10", from: "12:00", to: "17:00", layout: "grid" })).ok).toBe(true);
    expect(checkElement(el("SlotOption", { slotId: SLOT })).ok).toBe(true);
    expect(checkElement(el("BookingList", { references: ["3F9A12BC"] })).ok).toBe(true);
    expect(
      checkElement(el("ActionButton", { label: "Friday?" }, [], { on: { press: { action: "showDay", params: { date: "2030-01-11" } } } }))
        .ok,
    ).toBe(true);
  });

  it.each([
    ["unknown component", el("Iframe", { src: "https://example.com" })],
    ["prototype key as type", el("constructor")],
    ["unknown prop", el("Text", { text: "hi", html: "<b>x</b>" })],
    ["dynamic expression", el("Text", { text: { $state: "/x" } })],
    ["wrong enum", el("Card", { tone: "red" })],
    ["bad date", el("SlotPicker", { date: "Thursday" })],
    ["bad slot id", el("SlotOption", { slotId: "16:30" })],
    ["text too long", el("Text", { text: "x".repeat(601) })],
    ["children on a leaf", el("Text", { text: "hi" }, ["child"])],
    ["action on a non-button", el("Card", {}, [], { on: { press: { action: "showDay", params: { date: "2030-01-11" } } } })],
    ["action outside allowlist", el("ActionButton", { label: "Go" }, [], { on: { press: { action: "approveBooking", params: {} } } })],
    ["built-in action", el("ActionButton", { label: "Go" }, [], { on: { press: { action: "setState", params: { statePath: "/x", value: 1 } } } })],
    ["invalid action params", el("ActionButton", { label: "Go" }, [], { on: { press: { action: "selectSlot", params: { slotId: "x" } } } })],
    ["button without action", el("ActionButton", { label: "Go" })],
    ["watcher", el("Card", {}, [], { watch: { "/x": { action: "showDay" } } })],
    ["visibility", el("Card", {}, [], { visible: { $state: "/x" } })],
    ["repeat", el("Stack", {}, ["a"], { repeat: { statePath: "/items" } })],
  ])("rejects %s", (_, element) => {
    expect(checkElement(element).ok).toBe(false);
  });

  it("only allows setting the root and whole elements", () => {
    expect(checkPatch({ op: "add", path: "/root", value: "main" }).ok).toBe(true);
    expect(checkPatch({ op: "replace", path: "/elements/main", value: el("Divider") }).ok).toBe(true);
    expect(checkPatch({ op: "add", path: "/state/booked", value: true }).ok).toBe(false);
    expect(checkPatch({ op: "add", path: "/elements/main/props/text", value: "x" }).ok).toBe(false);
    expect(checkPatch({ op: "remove", path: "/elements/main" }).ok).toBe(false);
    expect(checkPatch({ op: "move", from: "/elements/a", path: "/elements/b" }).ok).toBe(false);
    expect(checkPatch({ op: "add", path: "/root", value: "../x" }).ok).toBe(false);
    expect(checkPatch({ op: "add", path: "/elements/__proto__x/", value: el("Divider") }).ok).toBe(false);
  });

  it("requires a finished spec to be a complete tree", () => {
    const spec: GenSpec = {
      root: "a",
      elements: { a: { type: "Stack", props: {}, children: ["b"] } },
    };
    expect(checkSpec(spec, { final: false }).ok).toBe(true);
    expect(checkSpec(spec, { final: true }).ok).toBe(false);
    spec.elements.b = { type: "Divider", props: {}, children: [] };
    expect(checkSpec(spec, { final: true }).ok).toBe(true);
  });

  it("rejects cycles, shared children, deep trees and oversized specs", () => {
    const cycle: GenSpec = {
      root: "a",
      elements: {
        a: { type: "Stack", props: {}, children: ["b"] },
        b: { type: "Stack", props: {}, children: ["a"] },
      },
    };
    expect(checkSpec(cycle, { final: false })).toEqual({ ok: false, reason: "element used twice" });

    const shared: GenSpec = {
      root: "a",
      elements: {
        a: { type: "Stack", props: {}, children: ["b", "b"] },
        b: { type: "Divider", props: {}, children: [] },
      },
    };
    expect(checkSpec(shared, { final: true }).ok).toBe(false);

    const deep: GenSpec = { root: "n0", elements: {} };
    for (let i = 0; i < 10; i++) deep.elements[`n${i}`] = { type: "Stack", props: {}, children: [`n${i + 1}`] };
    expect(checkSpec(deep, { final: false })).toEqual({ ok: false, reason: "tree too deep" });

    const big: GenSpec = { root: "", elements: {} };
    for (let i = 0; i <= MAX_ELEMENTS; i++) big.elements[`e${i}`] = { type: "Divider", props: {}, children: [] };
    expect(checkSpec(big, { final: false }).ok).toBe(false);
  });

  it("splits a message into separate UI blocks around other parts", () => {
    const patch = (p: object) => ({ type: "data-spec", data: { type: "patch", patch: p } });
    const parts = [
      { type: "text", text: "Here:" },
      patch({ op: "add", path: "/root", value: "a" }),
      { type: "text", text: "\n" },
      patch({ op: "add", path: "/elements/a", value: el("Divider") }),
      patch({ op: "add", path: "/elements/x", value: el("Nope") }),
      { type: "tool-createBooking" },
      patch({ op: "add", path: "/root", value: "b" }),
      patch({ op: "add", path: "/elements/b", value: el("Text", { text: "after" }) }),
    ];
    const segments = specSegments(parts);
    expect(segments.map((s) => [s.start, s.end, s.spec.root, Object.keys(s.spec.elements), s.rejected])).toEqual([
      [1, 5, "a", ["a"], 1],
      [6, 8, "b", ["b"], 0],
    ]);
  });
});

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<T>) out.push(chunk);
  return out;
}

function chunkStream(chunks: object[]) {
  return new ReadableStream<{ type: string }>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c as { type: string }));
      controller.close();
    },
  });
}

const textChunks = (text: string, size: number) => [
  { type: "text-start", id: "0" },
  ...Array.from({ length: Math.ceil(text.length / size) }, (_, i) => ({
    type: "text-delta",
    id: "0",
    delta: text.slice(i * size, (i + 1) * size),
  })),
  { type: "text-end", id: "0" },
];

describe("generated UI stream", () => {
  it("separates prose from spec patches and keeps one text chunk per model token", async () => {
    const text = `Here are the times.\n\`\`\`spec\n{"op":"add","path":"/root","value":"m"}\n{"op":"add","path":"/elements/m","value":{"type":"Divider","props":{},"children":[]}}\n\`\`\`\nAnything else?`;
    const out = (await collect(withGenerativeUI(chunkStream(textChunks(text, 6))))) as Array<Record<string, unknown>>;

    const prose = out.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    expect(prose).toBe("Here are the times.\nAnything else?");
    expect(out.filter((c) => c.type === "data-spec").map((c) => (c.data as { patch: { path: string } }).patch.path)).toEqual([
      "/root",
      "/elements/m",
    ]);
    // No per-character chunks: at most one delta per upstream delta.
    expect(out.filter((c) => c.type === "text-delta").length).toBeLessThanOrEqual(Math.ceil(text.length / 6));
    expect(out.some((c) => c.type === "x-genui-boundary")).toBe(false);
    // Text blocks are balanced so the client can assemble parts.
    const starts = out.filter((c) => c.type === "text-start").length;
    expect(out.filter((c) => c.type === "text-end").length).toBe(starts);
  });

  it("drops invalid patches and tells the client once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = `UI:\n\`\`\`spec\n{"op":"add","path":"/state/x","value":1}\n{"op":"add","path":"/elements/a","value":{"type":"Bad","props":{},"children":[]}}\n{"op":"add","path":"/root","value":"a"}\n\`\`\``;
    const out = (await collect(withGenerativeUI(chunkStream(textChunks(text, 40))))) as Array<Record<string, unknown>>;
    expect(out.filter((c) => c.type === "data-spec")).toHaveLength(1);
    expect(out.filter((c) => c.type === "data-uiNotice")).toEqual([{ type: "data-uiNotice", data: { kind: "spec-rejected" } }]);
    warn.mockRestore();
  });

  it("passes non-text chunks through untouched", async () => {
    const chunks = [
      { type: "start" },
      { type: "tool-input-available", toolCallId: "c", toolName: "listServices", input: {} },
      { type: "finish" },
    ];
    expect(await collect(chunkStream(chunks).pipeThrough(coalesceTextDeltas()))).toEqual(chunks);
  });
});

describe("generated UI prompt", () => {
  it("reuses the catalog's component list but none of the stock data-inventing rules", () => {
    for (const name of ["SlotPicker", "SlotOption", "DayOverview", "BookingList", "ActionButton"]) {
      expect(GENERATIVE_UI_INSTRUCTIONS).toContain(`- ${name}:`);
    }
    expect(GENERATIVE_UI_INSTRUCTIONS).not.toMatch(/sample data|pushState|setState|\$bindState/);
  });

  it("asks for a BookingList with its empty state for 'my bookings', without repeating earlier UI", () => {
    expect(GENERATIVE_UI_INSTRUCTIONS).toContain("answer with a BookingList, also when there are none");
    expect(GENERATIVE_UI_INSTRUCTIONS).toContain("Do not repeat UI from earlier replies");
  });
});

const slotView: SlotView = {
  slotId: SLOT,
  serviceId: "s",
  date: "2030-01-10",
  dateLabel: "Thursday 10 January 2030",
  startTime: "16:30",
  endTime: "17:00",
  providerName: "Eva Physio",
  timeZone: "Europe/Prague",
};
const data: BookingData = {
  slots: new Map([[SLOT, slotView]]),
  slotsByDate: new Map([["2030-01-10", [slotView]]]),
  days: [],
  services: new Map(),
  bookings: new Map(),
  selectedSlotIds: new Set(),
};

describe("generated UI actions", () => {
  it("selects only slots returned by tools, sending the authoritative id", () => {
    const send = vi.fn(() => true);
    expect(runAction("selectSlot", { slotId: SLOT }, { data, send })).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({ text: "I'd like the 16:30 appointment on Thursday 10 January 2030.", slotId: SLOT });

    send.mockClear();
    const unknown = "99999999-2222-4333-8444-555555555555";
    expect(runAction("selectSlot", { slotId: unknown }, { data, send })).toEqual({ ok: false, reason: "unknown slot" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects actions outside the allowlist and invalid parameters", () => {
    const send = vi.fn(() => true);
    expect(runAction("approveBooking", { slotId: SLOT }, { data, send }).ok).toBe(false);
    expect(runAction("setState", { statePath: "/x" }, { data, send }).ok).toBe(false);
    expect(runAction("toString", {}, { data, send }).ok).toBe(false);
    expect(runAction("showDay", { date: "tomorrow" }, { data, send }).ok).toBe(false);
    expect(runAction("sendMessage", { text: "x".repeat(161) }, { data, send }).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("turns day and follow-up actions into guest messages", () => {
    const send = vi.fn(() => true);
    runAction("showDay", { date: "2030-01-11" }, { data, send });
    runAction("sendMessage", { text: " What about Friday? " }, { data, send });
    expect(send.mock.calls).toEqual([
      [{ text: "Show me the free times on Friday 11 January 2030." }],
      [{ text: "What about Friday?" }],
    ]);
  });

  it("reports a busy chat instead of queueing", () => {
    expect(runAction("selectSlot", { slotId: SLOT }, { data, send: () => false })).toEqual({ ok: false, reason: "busy" });
  });
});
