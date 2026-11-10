import { Check, Clock } from "lucide-react";
import type { Service } from "@/domain/booking";

type Props = {
  service: Service;
  /** When provided, the card is a selectable option. */
  selected?: boolean;
  onSelect?: (serviceId: string) => void;
};

export function ServiceCard({ service, selected = false, onSelect }: Props) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-ink">{service.name}</p>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sage-50 px-2.5 py-1 text-xs font-medium text-sage-800">
          <Clock aria-hidden className="size-3.5" />
          {service.durationMinutes} min
        </span>
      </div>
      {service.description && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{service.description}</p>}
    </>
  );

  if (!onSelect) {
    return (
      <div data-testid="service-card" className="rounded-2xl border border-sand-200 bg-white p-4">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="service-card"
      aria-pressed={selected}
      onClick={() => onSelect(service.id)}
      className={`relative w-full rounded-2xl border bg-white p-4 text-left transition ${
        selected ? "border-sage-500 ring-2 ring-sage-200" : "border-sand-200 hover:border-sage-300"
      }`}
    >
      {content}
      {selected && <Check aria-hidden className="absolute right-3 bottom-3 size-4 text-sage-600" />}
    </button>
  );
}
