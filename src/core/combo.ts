// Text/glow styling that escalates with streak length — a small visual
// "juice" cue that a run is building, shared across the discrete-question
// formats (Manifest has no discrete right/wrong rhythm, so no combo there).
export function comboClass(combo: number): string {
  if (combo >= 8) {
    return "text-base font-semibold text-cat-red dark:text-cat-red-dark ring-2 ring-cat-red/50 dark:ring-cat-red-dark/50";
  }
  if (combo >= 5) {
    return "text-base font-semibold text-cat-orange dark:text-cat-orange-dark ring-2 ring-cat-orange/40 dark:ring-cat-orange-dark/40";
  }
  if (combo >= 3) {
    return "font-medium text-cat-yellow dark:text-cat-yellow-dark ring-1 ring-cat-yellow/30 dark:ring-cat-yellow-dark/30";
  }
  return "text-ink dark:text-ink-dark";
}

// The emoji escalates at the same thresholds as comboClass, so color/weight/
// glow/icon all read as one coherent "getting hotter" ramp rather than
// independent signals.
export function comboEmoji(combo: number): string {
  if (combo >= 8) return "🚀";
  if (combo >= 5) return "🌟";
  if (combo >= 3) return "⚡";
  return "🔥";
}

// A stable bucket id for the current tier — used as a React `key` so the
// combo pill remounts (replaying its pop-in) only when crossing into a new
// tier, not on every single correct answer within the same tier.
export function comboTier(combo: number): number {
  if (combo >= 8) return 3;
  if (combo >= 5) return 2;
  if (combo >= 3) return 1;
  return 0;
}
