import { BadgeCheck, CalendarClock, UserRound } from "lucide-react";
import type { ReactNode } from "react";

const HIGHLIGHTS = [
  { icon: CalendarClock, text: "Real-time availability" },
  { icon: BadgeCheck, text: "Instant confirmation" },
  { icon: UserRound, text: "No account needed" },
];

/** Hero copy with the booking capability placed directly beside it. */
export function LandingHero({ booking }: { booking: ReactNode }) {
  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-8 px-5 pt-2 pb-16 sm:gap-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16 lg:pt-14 lg:pb-24"
    >
      <div className="lg:sticky lg:top-14">
        <p className="inline-flex items-center gap-2 rounded-full border border-sage-200 bg-sage-50 px-3 py-1 text-xs font-medium text-sage-800">
          Physiotherapy · Prague
        </p>
        <h1
          id="hero-title"
          className="font-display mt-4 text-[2.6rem] leading-[1.05] font-semibold tracking-tight text-ink sm:mt-5 sm:text-6xl lg:text-7xl"
        >
          Move better.
          <br />
          <span className="text-sage-700">Feel better.</span>
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted sm:mt-6 sm:text-lg">
          Personalized physiotherapy consultations. Find an available appointment and book directly&nbsp;&mdash; it
          takes less than a minute.
        </p>
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-ink sm:mt-8 sm:gap-x-6 sm:gap-y-3 sm:text-sm">
          {HIGHLIGHTS.map(({ icon: Icon, text }) => (
            <li key={text} className="inline-flex items-center gap-2">
              <Icon aria-hidden className="size-4.5 text-sage-600" />
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div id="book" className="scroll-mt-6">
        {booking}
      </div>
    </section>
  );
}
