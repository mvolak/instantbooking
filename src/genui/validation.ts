import { applySpecPatch, type JsonPatch, type SpecDataPart } from "@json-render/core";
import { z } from "zod";
import { ACTIONABLE, actionParams, componentProps, CONTAINERS, type ActionName, type ComponentName } from "./catalog";

/**
 * Validation of generated UI. Runs on the server (every streamed patch, before
 * it reaches the browser) and again in the browser (the assembled spec, before
 * rendering), so neither a misbehaving model nor a tampered message can render
 * an unknown component, invalid props or an action outside the allowlist.
 *
 * The accepted spec language is intentionally a strict subset of json-render:
 * literal props only (no $state/$cond/$template expressions), no state model,
 * no repeat, visibility or watchers, and patches limited to setting the root
 * and adding or replacing whole elements.
 */

export const MAX_ELEMENTS = 40;
export const MAX_CHILDREN = 24;
export const MAX_DEPTH = 8;
/** Patches accepted per assistant response; anything beyond is dropped. */
export const MAX_PATCHES_PER_RESPONSE = 60;

const keySchema = z.string().regex(/^[A-Za-z0-9_-]{1,48}$/);

const elementShape = z.strictObject({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(keySchema).max(MAX_CHILDREN).default([]),
  on: z.strictObject({ press: z.strictObject({ action: z.string(), params: z.unknown().optional() }) }).optional(),
});

export type ActionBindingSpec = { action: ActionName; params: Record<string, unknown> };
export type GenElement = {
  type: ComponentName;
  props: Record<string, unknown>;
  children: string[];
  on?: { press: ActionBindingSpec };
};
export type GenSpec = { root: string; elements: Record<string, GenElement> };

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const isComponent = (type: string): type is ComponentName => Object.hasOwn(componentProps, type);
const isAction = (name: string): name is ActionName => Object.hasOwn(actionParams, name);

/** Validates one element against the catalog and the action allowlist. */
export function checkElement(value: unknown): Result<GenElement> {
  const shape = elementShape.safeParse(value);
  if (!shape.success) return { ok: false, reason: "malformed element" };
  const { type, props, children, on } = shape.data;
  if (!isComponent(type)) return { ok: false, reason: `unknown component ${JSON.stringify(type).slice(0, 40)}` };

  const parsedProps = componentProps[type].safeParse(props);
  if (!parsedProps.success) return { ok: false, reason: `invalid props for ${type}` };
  if (children.length > 0 && !CONTAINERS.has(type)) return { ok: false, reason: `${type} cannot have children` };

  let binding: ActionBindingSpec | undefined;
  if (on) {
    if (!ACTIONABLE.has(type)) return { ok: false, reason: `${type} cannot have actions` };
    if (!isAction(on.press.action)) return { ok: false, reason: `action not allowed: ${on.press.action.slice(0, 40)}` };
    const params = actionParams[on.press.action].safeParse(on.press.params ?? {});
    if (!params.success) return { ok: false, reason: `invalid params for ${on.press.action}` };
    binding = { action: on.press.action, params: params.data };
  } else if (ACTIONABLE.has(type)) {
    return { ok: false, reason: `${type} needs an action` };
  }

  return {
    ok: true,
    value: { type, props: parsedProps.data as Record<string, unknown>, children, ...(binding && { on: { press: binding } }) },
  };
}

/** Validates one streamed patch. Only `/root` and whole `/elements/<key>` writes are allowed. */
export function checkPatch(patch: unknown): Result<JsonPatch> {
  if (typeof patch !== "object" || patch === null) return { ok: false, reason: "malformed patch" };
  const { op, path, value } = patch as { op?: unknown; path?: unknown; value?: unknown };
  if (op !== "add" && op !== "replace") return { ok: false, reason: `operation not allowed: ${String(op).slice(0, 20)}` };
  if (path === "/root") {
    return keySchema.safeParse(value).success
      ? { ok: true, value: { op, path, value: value as string } }
      : { ok: false, reason: "invalid root key" };
  }
  const match = typeof path === "string" ? /^\/elements\/([A-Za-z0-9_-]{1,48})$/.exec(path) : null;
  if (!match) return { ok: false, reason: `path not allowed: ${String(path).slice(0, 60)}` };
  const element = checkElement(value);
  if (!element.ok) return element;
  return { ok: true, value: { op, path: path as string, value: element.value } };
}

/**
 * Checks an assembled spec. While streaming (`final: false`) children may
 * still be missing; a finished spec must be a complete tree.
 */
export function checkSpec(spec: GenSpec, { final }: { final: boolean }): Result<GenSpec> {
  const keys = Object.keys(spec.elements);
  if (keys.length > MAX_ELEMENTS) return { ok: false, reason: "too many elements" };
  if (!spec.root) return final ? { ok: false, reason: "no root" } : { ok: true, value: spec };
  if (!Object.hasOwn(spec.elements, spec.root)) {
    return final ? { ok: false, reason: "root element missing" } : { ok: true, value: spec };
  }

  // Every element is reachable at most once (a tree: no cycles, no shared children).
  const seen = new Set<string>();
  const walk = (key: string, depth: number): string | null => {
    if (depth > MAX_DEPTH) return "tree too deep";
    if (seen.has(key)) return "element used twice";
    seen.add(key);
    const element = spec.elements[key];
    if (!element) return final ? `missing element ${key}` : null;
    for (const child of element.children) {
      const problem = walk(child, depth + 1);
      if (problem) return problem;
    }
    return null;
  };
  const problem = walk(spec.root, 1);
  return problem ? { ok: false, reason: problem } : { ok: true, value: spec };
}

/** One generated UI block: consecutive spec patches within an assistant message. */
export type SpecSegment = {
  /** Index of the first patch part in `message.parts`. */
  start: number;
  /** Index after the last patch part. */
  end: number;
  spec: GenSpec;
  /** Patches that failed validation and were ignored. */
  rejected: number;
};

type PartLike = { type: string; data?: unknown; text?: string };

const isSpecPart = (part: PartLike): part is { type: "data-spec"; data: SpecDataPart } => part.type === "data-spec";
/** Parts that do not interrupt a spec block (whitespace, step markers). */
const isTransparent = (part: PartLike) =>
  part.type === "step-start" || (part.type === "text" && !(part.text ?? "").trim());

/**
 * Groups a message's spec patches into separate UI blocks and applies each
 * validated patch. A message can therefore contain several independent
 * generated UIs (for example availability before an approval, and a
 * confirmation after it), each rendered where it was streamed.
 */
export function specSegments(parts: readonly PartLike[]): SpecSegment[] {
  const segments: SpecSegment[] = [];
  let current: SpecSegment | null = null;
  parts.forEach((part, index) => {
    if (isSpecPart(part)) {
      current ??= { start: index, end: index + 1, spec: { root: "", elements: {} }, rejected: 0 };
      current.end = index + 1;
      const data = part.data as { type?: unknown; patch?: unknown };
      const checked = data?.type === "patch" ? checkPatch(data.patch) : null;
      if (checked?.ok && !exceedsElementLimit(current.spec, checked.value)) {
        applySpecPatch(current.spec as never, checked.value);
      } else {
        current.rejected++;
      }
      return;
    }
    if (current && isTransparent(part)) return;
    if (current) segments.push(current);
    current = null;
  });
  if (current) segments.push(current);
  return segments;
}

function exceedsElementLimit(spec: GenSpec, patch: JsonPatch): boolean {
  const key = patch.path.startsWith("/elements/") ? patch.path.slice("/elements/".length) : null;
  return key !== null && !Object.hasOwn(spec.elements, key) && Object.keys(spec.elements).length >= MAX_ELEMENTS;
}

/**
 * Server side: drops spec patches that fail validation before they reach the
 * browser, caps the number per response, and tells the client when something
 * was dropped so it can fall back to deterministic UI.
 */
export function validateSpecStream<T extends { type: string }>(): TransformStream<T, T> {
  let accepted = 0;
  let noticeSent = false;
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      if (chunk.type !== "data-spec") {
        controller.enqueue(chunk);
        return;
      }
      const data = (chunk as unknown as { data?: { type?: unknown; patch?: unknown } }).data;
      const checked = data?.type === "patch" ? checkPatch(data.patch) : { ok: false as const, reason: "unsupported spec payload" };
      if (checked.ok && accepted < MAX_PATCHES_PER_RESPONSE) {
        accepted++;
        controller.enqueue({ ...chunk, data: { type: "patch", patch: checked.value } } as T);
        return;
      }
      console.warn("[genui] dropped patch:", checked.ok ? "too many patches" : checked.reason);
      if (!noticeSent) {
        noticeSent = true;
        controller.enqueue({ type: "data-uiNotice", data: { kind: "spec-rejected" } } as unknown as T);
      }
    },
  });
}
