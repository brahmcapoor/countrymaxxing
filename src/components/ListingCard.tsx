import type { Listing } from "../core/types";
import { motion } from "framer-motion";
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
    <motion.button
      onClick={() => onSelect(listing.id)}
      className={`group w-full rounded-md border border-border bg-paper-card px-5 py-4 text-left border-l-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-border-dark dark:bg-paper-card-dark ${accentClass}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <h3 className="font-serif text-lg font-semibold text-ink dark:text-ink-dark">
        {listing.title}
      </h3>
      <p className="mt-1 text-sm text-ink-soft dark:text-ink-soft-dark">{listing.tagline}</p>
    </motion.button>
  );
}
