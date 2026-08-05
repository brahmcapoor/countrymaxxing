import { useMemo } from "react";
import type { Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import type { TalliedItem } from "../../core/sessionTally";
import { tierByCcn3 } from "./engine";
import { TierLegend } from "./TierLegend";

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
  // Same computation One Stop uses live while playing (see engine.ts's
  // tierByCcn3) — one implementation of "session history becomes a color,"
  // just called once here instead of every render.
  const reviewTierByCcn3 = useMemo(() => tierByCcn3(pool, sessionTally), [pool, sessionTally]);
  // Hovering any country (asked or not) shows its capital — this map has no
  // "spoiler" concern the way a live question does, the session is over.
  const labelsByCcn3 = useMemo(() => new Map(pool.map((c) => [c.ccn3, `${c.name} — ${c.capital}`] as const)), [pool]);

  return (
    <div className="mt-6">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border dark:border-border-dark">
          <WorldMap
            filledCcn3s={new Set()}
            reviewTierByCcn3={reviewTierByCcn3}
            labelsByCcn3={labelsByCcn3}
            focusCcn3s={poolCcn3s}
            pointCountries={pointCountries}
            className="h-56 w-full"
          />
        </div>
        {/* Positioned beside the map rather than below it so it reads as an
            axis for what's on the map, not a caption under it — same idea
            as a chart's colorbar. */}
        <TierLegend tierByCcn3={reviewTierByCcn3} />
      </div>
      <p className="mt-2 text-center text-xs text-ink-soft dark:text-ink-soft-dark">
        Brighter green = fewer tries · brighter red = more tries · gray = not asked this session · hover a country
        for its capital
      </p>
    </div>
  );
}
