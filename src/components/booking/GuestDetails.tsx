import type { FormEvent } from "react";
import { Spinner } from "./feedback";

type Props = {
  name: string;
  error: string | null;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  /** Human summary of the selected appointment, or null when no time is selected yet. */
  selection: string | null;
  labelledBy: string;
};

export function GuestDetails({ name, error, onNameChange, onSubmit, submitting, selection, labelledBy }: Props) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form aria-labelledby={labelledBy} noValidate onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="guest-name" className="mb-1.5 block text-sm font-medium text-ink">
          Your name
        </label>
        <input
          id="guest-name"
          name="guestName"
          type="text"
          autoComplete="name"
          maxLength={100}
          required
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "guest-name-error" : undefined}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="e.g. Jana Nováková"
          className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink-muted/60 focus:ring-2 focus:outline-none ${
            error ? "border-red-400 focus:ring-red-200" : "border-sand-300 focus:border-sage-500 focus:ring-sage-200"
          }`}
        />
        {error && (
          <p id="guest-name-error" className="mt-1.5 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!selection || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sage-700 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-sage-800 disabled:cursor-not-allowed disabled:bg-sage-300"
      >
        {submitting ? (
          <>
            <Spinner />
            Booking…
          </>
        ) : selection ? (
          `Book ${selection}`
        ) : (
          "Choose a time to continue"
        )}
      </button>
    </form>
  );
}
