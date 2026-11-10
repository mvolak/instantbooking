import { CalendarCheck, MessagesSquare, ShieldCheck } from "lucide-react";
import { BookingChat } from "@/components/chat/BookingChat";

const POINTS = [
  { icon: MessagesSquare, text: "Ask in your own words: “Anything on Thursday afternoon?”" },
  { icon: CalendarCheck, text: "Answers come from the studio’s live calendar, never guesses." },
  { icon: ShieldCheck, text: "Nothing is booked until you confirm the details yourself." },
];

/** The conversational booking channel, alongside the classic form above. */
export function ChatSection() {
  return (
    <section id="chat" aria-labelledby="chat-title" className="scroll-mt-4">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-24">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sage-700 uppercase">New</p>
          <h2 id="chat-title" className="font-display mt-2 text-3xl font-semibold text-ink sm:text-4xl">
            Prefer to just ask?
          </h2>
          <p className="mt-3 text-ink-muted">
            Chat with our booking assistant. It checks real availability and prepares the booking; you confirm it.
          </p>
          <ul className="mt-6 space-y-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-ink">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sage-100 text-sage-700">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-ink-muted">
            The assistant is AI-powered and can make mistakes in conversation, but bookings are only made through the
            studio’s booking system and shown exactly as confirmed.
          </p>
        </div>
        <BookingChat />
      </div>
    </section>
  );
}
