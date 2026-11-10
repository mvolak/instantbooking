const FOCUS_AREAS = [
  { title: "Assessment & diagnosis", text: "A clear explanation of what’s going on and why." },
  { title: "Manual therapy", text: "Hands-on treatment to ease pain and restore mobility." },
  { title: "Exercise rehabilitation", text: "A personal programme you can follow at home." },
  { title: "Sports & desk injuries", text: "From running knees to stiff necks after long days." },
];

export function AboutStudio() {
  return (
    <section id="about" aria-labelledby="about-title" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
        <div>
          <h2 id="about-title" className="font-display text-3xl font-semibold text-ink sm:text-4xl">
            About Motion Studio
          </h2>
          <p className="mt-4 leading-relaxed text-ink-muted">
            We&rsquo;re a small physiotherapy practice helping people recover from injury, manage pain and move with
            confidence again. Every treatment starts with an unhurried first consultation, where we listen, assess and
            agree on a plan together.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {FOCUS_AREAS.map(({ title, text }) => (
            <li key={title} className="rounded-2xl border border-sand-200 bg-white p-5">
              <h3 className="font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
