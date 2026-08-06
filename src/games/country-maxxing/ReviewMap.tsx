import { useMemo } from "react";
import type { Country } from "../../data/countries";
import { REVIEW_TIER_MAX_TRIES, WorldMap } from "../../components/WorldMap";
import { MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import type { TalliedItem } from "../../core/sessionTally";
import { tierByCcn3 } from "./engine";

// Top-to-bottom, matching WorldMap.tsx's REVIEW_TIER_FILLS step-for-step —
// a real legend of the exact classes the map renders (4 green steps, gray,
// 4 red steps), not an idealized continuous gradient that wouldn't match.
// Written out literally, same reason as WorldMap.tsx's own fill classes:
// Tailwind's scanner needs the full class text, not a hue/opacity built
// from a variable.
const SCALE_SEGMENTS = [
  "bg-cat-green dark:bg-cat-green-dark",
  "bg-cat-green/75 dark:bg-cat-green-dark/75",
  "bg-cat-green/55 dark:bg-cat-green-dark/55",
  "bg-cat-green/35 dark:bg-cat-green-dark/35",
  "bg-black/10 dark:bg-white/14",
  "bg-cat-red/35 dark:bg-cat-red-dark/35",
  "bg-cat-red/55 dark:bg-cat-red-dark/55",
  "bg-cat-red/75 dark:bg-cat-red-dark/75",
  "bg-cat-red dark:bg-cat-red-dark",
];
// Same order as SCALE_SEGMENTS — the try count each segment represents, or
// null for the gray "not asked" segment, which has no try count at all.
const SCALE_STEPS: (number | null)[] = [
  REVIEW_TIER_MAX_TRIES,
  3,
  2,
  1,
  null,
  1,
  2,
  3,
  REVIEW_TIER_MAX_TRIES,
];

// Session-only difficulty tint — this session's miss count per country,
// not the persistent lifetime stats "weak spot" heuristic in engine.ts.
// Deliberately session-scoped: "how did today go" is a different question
// from "what am I weak on lifetime," and conflating them would make a
// single rough session look like a permanent trouble spot on this map.
export function ReviewMap({
  pool,
  sessionTally,
  sessionType,
}: {
  pool: Country[];
  sessionTally: TalliedItem[];
  // Quiz mode never requeues a miss (see engine.ts's tierByCcn3), so every
  // country lands on exactly 1 try — the darker-with-more-tries gradient
  // this legend explains never actually varies there, just a flat
  // right/wrong split. Showing a "darker = more tries" scale for a stat
  // that's always 1 is misleading, not just unhelpful, so it's Learn-mode
  // only; Quiz mode keeps the plain right/wrong map coloring without it.
  sessionType?: "learn" | "quiz";
}) {
  const showTriesScale = sessionType !== "quiz";
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
  // Which (outcome, try count) combinations actually occurred this session —
  // the scale's number labels only show for these, rather than a fixed
  // 1/2/3/4+ set regardless of what really happened. Steps are keyed by the
  // same clamped value used to pick each country's fill class (a give-up
  // already collapses to REVIEW_TIER_MAX_TRIES there), so a labeled "4+"
  // always corresponds to something actually shown that color on the map.
  const presentSteps = useMemo(() => {
    const correct = new Set<number>();
    const wrong = new Set<number>();
    for (const tier of reviewTierByCcn3.values()) {
      const step = Math.min(tier.tries, REVIEW_TIER_MAX_TRIES);
      (tier.outcome === "correct" ? correct : wrong).add(step);
    }
    return { correct, wrong };
  }, [reviewTierByCcn3]);

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
        {/* The gradient scale, positioned beside the map rather than below it
            so it reads as an axis for what's on the map, not a caption under
            it — same idea as a chart's colorbar. Try-count labels sit beside
            the bar rather than inside it (too narrow for text) and only
            appear for steps this session actually produced. Learn mode only
            — see showTriesScale. */}
        {showTriesScale && (
          <div className="flex w-14 shrink-0 flex-col items-center">
            <span className="text-[10px] font-medium uppercase tracking-wide text-cat-green dark:text-cat-green-dark">
              Right
            </span>
            <div className="relative mt-1 w-2.5 flex-1">
              <div className="flex h-full w-2.5 flex-col overflow-hidden rounded-full">
                {SCALE_SEGMENTS.map((swatchClass, i) => (
                  <span key={i} className={`flex-1 ${swatchClass}`} />
                ))}
              </div>
              {SCALE_STEPS.map((step, i) => {
                if (step === null) return null;
                const outcome = i < SCALE_SEGMENTS.length / 2 ? "correct" : "wrong";
                if (!presentSteps[outcome].has(step)) return null;
                const label = step < REVIEW_TIER_MAX_TRIES ? String(step) : `${REVIEW_TIER_MAX_TRIES}+`;
                return (
                  <span
                    key={i}
                    className="absolute left-4 -translate-y-1/2 text-[10px] tabular-nums text-ink-soft dark:text-ink-soft-dark"
                    style={{ top: `${((i + 0.5) / SCALE_SEGMENTS.length) * 100}%` }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-cat-red dark:text-cat-red-dark">
              Wrong
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-ink-soft dark:text-ink-soft-dark">
        {showTriesScale
          ? "Darker = more tries · gray = not asked this session · hover a country for its capital"
          : "Green = correct · red = missed · gray = not asked this session · hover a country for its capital"}
      </p>
    </div>
  );
}
