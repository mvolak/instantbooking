import type { AvailableDate } from "@/domain/booking";
import { formatDate, pluralize } from "./format";

type Props = {
  dates: AvailableDate[];
  selected: string | null;
  onSelect: (date: string) => void;
  labelledBy: string;
};

/** A horizontally scrollable strip of upcoming days; days without free times are disabled. */
export function DateSelector({ dates, selected, onSelect, labelledBy }: Props) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="-mx-1 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_88%,transparent)]"
    >
      <ul className="flex gap-2 px-1">
        {dates.map(({ date, availableSlots }) => {
          const { weekday, day, month } = formatDate(date, "parts");
          const isSelected = date === selected;
          const full = availableSlots === 0;
          const availability = full ? "no times available" : `${pluralize(availableSlots, "time", "times")} available`;
          return (
            <li key={date} className="shrink-0">
              <button
                type="button"
                disabled={full}
                aria-pressed={isSelected}
                aria-label={`${formatDate(date, "long")}, ${availability}`}
                onClick={() => onSelect(date)}
                className={`flex w-16 flex-col items-center rounded-xl border px-1 py-2 transition ${
                  isSelected
                    ? "border-sage-700 bg-sage-700 text-white"
                    : full
                      ? "cursor-not-allowed border-transparent bg-sand-100 text-ink-muted/50"
                      : "border-sand-200 bg-white text-ink hover:border-sage-300"
                }`}
              >
                <span className="text-[11px] font-medium tracking-wide uppercase">{weekday}</span>
                <span className="font-display text-xl leading-tight font-semibold">{day}</span>
                <span className="text-[11px]">{month}</span>
                <span
                  aria-hidden
                  className={`mt-1 size-1.5 rounded-full ${full ? "bg-transparent" : isSelected ? "bg-white" : "bg-sage-500"}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
