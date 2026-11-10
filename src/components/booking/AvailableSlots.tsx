import type { AvailableSlot } from "@/domain/booking";
import { formatTime, timezoneCity } from "./format";

type Props = {
  slots: AvailableSlot[];
  selected: string | null;
  onSelect: (slotId: string) => void;
  labelledBy: string;
};

/** Free times for one day, shown in the provider's local time. */
export function AvailableSlots({ slots, selected, onSelect, labelledBy }: Props) {
  const timezone = slots[0]?.providerTimezone;
  return (
    <div>
      <ul role="group" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((slot) => {
          const isSelected = slot.id === selected;
          const time = formatTime(slot.startsAtLocal);
          return (
            <li key={slot.id}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`${time} to ${formatTime(slot.endsAtLocal)} with ${slot.providerName}`}
                onClick={() => onSelect(slot.id)}
                className={`w-full rounded-xl border py-2.5 text-sm font-medium tabular-nums transition ${
                  isSelected
                    ? "border-sage-700 bg-sage-700 text-white"
                    : "border-sand-200 bg-white text-ink hover:border-sage-400 hover:bg-sage-50"
                }`}
              >
                {time}
              </button>
            </li>
          );
        })}
      </ul>
      {timezone && (
        <p className="mt-2 text-xs text-ink-muted">
          Times shown in {timezoneCity(timezone)} time ({timezone}).
        </p>
      )}
    </div>
  );
}

export function SlotsSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-xl bg-sand-100" />
      ))}
    </div>
  );
}
