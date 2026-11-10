import { AlertCircle, Info, LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <LoaderCircle aria-hidden className={`${className} animate-spin`} />;
}

/** An error the user can act on; announced immediately to screen readers. */
export function ErrorMessage({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{children}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-medium text-red-900 underline-offset-2 hover:underline"
        >
          <RotateCw aria-hidden className="size-3.5" />
          Try again
        </button>
      )}
    </div>
  );
}

/** A non-error notice (e.g. a slot was just taken); announced politely. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function StepHeading({ step, id, children }: { step: number; id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-2.5 text-sm font-semibold text-ink">
      <span aria-hidden className="grid size-6 place-items-center rounded-full bg-sage-100 text-xs font-semibold text-sage-800">
        {step}
      </span>
      {children}
    </h3>
  );
}
