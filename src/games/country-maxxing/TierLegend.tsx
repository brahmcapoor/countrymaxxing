import { REVIEW_TIER_MAX_TRIES, type ReviewTier } from "../../components/WorldMap";

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
// Both halves read 1→4+ moving away from their own vivid outer edge toward
// the gray middle — the correct (green) side is most vivid at 1 try (a
// clean first-try win) and fades as tries climb; the wrong (red) side is
// the opposite of *that* but the same shape here, since it's faintest at 1
// miss and most vivid at 4+ (see WorldMap.tsx's reviewFillClassFor for why
// they run in opposite directions against the fill arrays despite matching
// here).
const SCALE_STEPS: (number | null)[] = [1, 2, 3, REVIEW_TIER_MAX_TRIES, null, 1, 2, 3, REVIEW_TIER_MAX_TRIES];

// The Right/Wrong gradient scale for WorldMap's reviewTierByCcn3 coloring —
// shared by the post-session summary (ReviewMap.tsx) and One Stop's own
// live map while playing (PromptAndAnswerPlay.tsx), so both read off one
// implementation instead of two copies drifting apart. Try-count labels
// sit beside the bar rather than inside it (too narrow for text) and only
// appear for steps the given tierByCcn3 actually contains — mid-session
// that's "so far," not a fixed 1/2/3/4+ set regardless of what's happened.
export function TierLegend({ tierByCcn3 }: { tierByCcn3: Map<string, ReviewTier> }) {
  const presentSteps = { correct: new Set<number>(), wrong: new Set<number>() };
  for (const tier of tierByCcn3.values()) {
    const step = Math.min(tier.tries, REVIEW_TIER_MAX_TRIES);
    (tier.outcome === "correct" ? presentSteps.correct : presentSteps.wrong).add(step);
  }

  return (
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
  );
}
