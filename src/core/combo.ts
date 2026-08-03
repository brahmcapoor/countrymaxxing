// Text styling that escalates with streak length — a small visual "juice"
// cue that a run is building, shared across the discrete-question formats.
export function comboClass(combo: number): string {
  if (combo >= 8) return "text-base font-semibold text-cat-red dark:text-cat-red-dark";
  if (combo >= 5) return "text-base font-semibold text-cat-orange dark:text-cat-orange-dark";
  if (combo >= 3) return "font-medium text-cat-yellow dark:text-cat-yellow-dark";
  return "text-ink dark:text-ink-dark";
}
