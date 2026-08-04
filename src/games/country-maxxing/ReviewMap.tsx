import { useMemo } from "react";
import type { Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import type { TalliedItem } from "../../core/sessionTally";

const LEGEND: { tier: 1 | 2 | 3; label: string; swatchClass: string }[] = [
  { tier: 1, label: "Right first try", swatchClass: "bg-cat-green/70 dark:bg-cat-green-dark/70" },
  { tier: 2, label: "Missed once", swatchClass: "bg-cat-yellow dark:bg-cat-yellow-dark" },
  { tier: 3, label: "Missed 2+ / gave up", swatchClass: "bg-cat-red dark:bg-cat-red-dark" },
];

// Session-only difficulty tint — this session's miss count per country,
// not the persistent lifetime stats "weak spot" heuristic in engine.ts.
// Deliberately session-scoped: "how did today go" is a different question
// from "what am I weak on lifetime," and conflating them would make a
// single rough session look like a permanent trouble spot on this map.
export function ReviewMap({ pool, sessionTally }: { pool: Country[]; sessionTally: TalliedItem[] }) {
  const poolCcn3s = useMemo(() => new Set(pool.map((c) => c.ccn3)), [pool]);
  // No single "current" country here to give a dedicated auto-zoom inset to
  // (this is a many-countries-at-once overview, not a per-question map) —
  // so every hard-to-render country, not just the non-inset subset, needs
  // the marker treatment or it falls back to its real (imperceptible)
  // polygon. Matches mapCoverage.ts's own guidance for this kind of context.
  const pointCountries = useMemo(
    () =>
      new Map(pool.filter((c) => MAP_HARD_TO_RENDER.has(c.cca3)).map((c) => [c.ccn3, c.capitalLatLng] as const)),
    [pool],
  );
  const reviewTierByCcn3 = useMemo(() => {
    const ccn3ByCca3 = new Map(pool.map((c) => [c.cca3, c.ccn3] as const));
    const tiers = new Map<string, 0 | 1 | 2 | 3>();
    for (const item of sessionTally) {
      const ccn3 = ccn3ByCca3.get(item.cca3);
      if (!ccn3) continue;
      const misses = item.attempts.filter((a) => !a).length;
      const tier: 0 | 1 | 2 | 3 = item.gaveUp || misses >= 2 ? 3 : misses === 1 ? 2 : 1;
      tiers.set(ccn3, tier);
    }
    return tiers;
  }, [pool, sessionTally]);

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-md border border-border dark:border-border-dark">
        <WorldMap
          filledCcn3s={new Set()}
          reviewTierByCcn3={reviewTierByCcn3}
          focusCcn3s={poolCcn3s}
          pointCountries={pointCountries}
          className="h-56 w-full"
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {LEGEND.map((entry) => (
          <span key={entry.tier} className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-ink-soft-dark">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${entry.swatchClass}`} />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}
