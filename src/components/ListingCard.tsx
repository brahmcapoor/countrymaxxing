import type { Listing } from "../core/types";
import { accentBorderClass, hueForIndex } from "../core/palette";

export function ListingCard({
  listing,
  index,
  onSelect,
}: {
  listing: Listing;
  index: number;
  onSelect: (id: string) => void;
}) {
  const accentClass = accentBorderClass(hueForIndex(index));

  return (
    <button
      onClick={() => onSelect(listing.id)}
      className={`group w-full rounded-md border border-border bg-paper-card px-5 py-4 text-left border-l-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-border-dark dark:bg-paper-card-dark ${accentClass}`}
    >
      <h3 className="font-serif text-lg font-semibold text-ink dark:text-ink-dark">
        {listing.title}
      </h3>
      <p className="mt-1 text-sm text-ink-soft dark:text-ink-soft-dark">{listing.tagline}</p>
    </button>
  );
}
