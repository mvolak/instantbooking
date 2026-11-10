import { CalendarDays, CircleCheckBig, PenLine } from "lucide-react";

const STEPS = [
  {
    icon: CalendarDays,
    title: "Pick a time",
    text: "See the studio’s real calendar and choose a day and time that suits you.",
  },
  {
    icon: PenLine,
    title: "Add your name",
    text: "That’s all we need. No sign-up, no passwords, no payment upfront.",
  },
  {
    icon: CircleCheckBig,
    title: "You’re booked",
    text: "Your appointment is confirmed instantly, with a booking reference on screen.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="border-y border-sand-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <h2 id="how-title" className="font-display text-3xl font-semibold text-ink sm:text-4xl">
          Booking in three steps
        </h2>
        <p className="mt-3 max-w-2xl text-ink-muted">
          The booking form above talks to the same scheduling system our team uses, so what you see is what&rsquo;s
          actually free.
        </p>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="rounded-2xl border border-sand-200 bg-sand-50 p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-sage-100 text-sage-700">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-sm font-medium text-ink-muted">Step {index + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
