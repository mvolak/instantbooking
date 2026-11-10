import { Activity } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
      <a href="#top" className="inline-flex items-center gap-2 rounded-lg font-semibold text-ink">
        <span className="grid size-8 place-items-center rounded-lg bg-sage-700 text-white">
          <Activity aria-hidden className="size-4.5" />
        </span>
        Motion Studio
      </a>
      <nav aria-label="Main">
        <ul className="flex items-center gap-1 text-sm sm:gap-2">
          <li className="hidden sm:block">
            <a href="#how-it-works" className="rounded-lg px-3 py-2 text-ink-muted hover:text-ink">
              How it works
            </a>
          </li>
          <li className="hidden sm:block">
            <a href="#about" className="rounded-lg px-3 py-2 text-ink-muted hover:text-ink">
              About
            </a>
          </li>
          <li>
            <a
              href="#book"
              className="rounded-full bg-ink px-4 py-2 font-medium text-white transition hover:bg-sage-900"
            >
              Book now
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
