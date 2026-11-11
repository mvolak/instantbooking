"use client";

import { JSONUIProvider, Renderer, type ComponentRegistry } from "@json-render/react";
import { Component, useMemo, type ReactNode } from "react";
import { createActionHandlers, runAction, type ActionContext } from "./actions";
import type { ActionName } from "./catalog";
import { GenUIContext, registry as defaultRegistry, type GenUIRuntime } from "./registry";
import { checkSpec, type SpecSegment } from "./validation";

type Props = {
  segment: SpecSegment;
  /** The message is still streaming: the spec may be incomplete. */
  streaming: boolean;
  /** Authoritative data and the trusted way to act on it. */
  context: ActionContext;
  disabled: boolean;
  registry?: ComponentRegistry;
};

/**
 * Renders one generated UI block. The assembled spec is validated again here
 * (the server already validated each patch): an incomplete spec renders
 * progressively while streaming, an invalid finished spec renders nothing
 * but a short note, and a render error is contained to this block.
 */
export function GeneratedUI({ segment, streaming, context, disabled, registry = defaultRegistry }: Props) {
  const handlers = useMemo(() => createActionHandlers(() => context), [context]);
  const runtime = useMemo<GenUIRuntime>(
    () => ({
      data: context.data,
      disabled,
      run: (action: ActionName, params: Record<string, unknown>) => {
        if (disabled) return;
        const result = runAction(action, params, context);
        if (!result.ok) console.warn(`[genui] action ${action} ignored: ${result.reason}`);
      },
    }),
    [context, disabled],
  );

  const checked = checkSpec(segment.spec, { final: !streaming });
  if (!checked.ok) {
    return streaming ? null : <UnavailableNote />;
  }

  return (
    <div data-testid="generated-ui" aria-busy={streaming} className="space-y-3">
      <UIErrorBoundary fallback={<UnavailableNote />}>
        <GenUIContext.Provider value={runtime}>
          <JSONUIProvider registry={registry} handlers={handlers}>
            <Renderer spec={checked.value} registry={registry} loading={streaming} />
          </JSONUIProvider>
        </GenUIContext.Provider>
      </UIErrorBoundary>
    </div>
  );
}

function UnavailableNote() {
  return (
    <p role="status" className="text-xs text-ink-muted">
      Part of this reply couldn’t be displayed.
    </p>
  );
}

class UIErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[genui] render failed:", error instanceof Error ? error.message : error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
