// Fixed hue order — validated for CVD-safety and contrast in light & dark.
// Never reorder or cycle; a 9th game folds into a shared "more" slot instead.
const CATEGORICAL_HUES = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
] as const;

export type CategoricalHue = (typeof CATEGORICAL_HUES)[number];

export function hueForIndex(index: number): CategoricalHue {
  return CATEGORICAL_HUES[index % CATEGORICAL_HUES.length]!;
}

// Full literal class strings — Tailwind's scanner needs these written out,
// not assembled from a template string, or it won't generate the rules.
const BORDER_CLASSES: Record<CategoricalHue, string> = {
  blue: "border-l-cat-blue dark:border-l-cat-blue-dark",
  orange: "border-l-cat-orange dark:border-l-cat-orange-dark",
  aqua: "border-l-cat-aqua dark:border-l-cat-aqua-dark",
  yellow: "border-l-cat-yellow dark:border-l-cat-yellow-dark",
  magenta: "border-l-cat-magenta dark:border-l-cat-magenta-dark",
  green: "border-l-cat-green dark:border-l-cat-green-dark",
  violet: "border-l-cat-violet dark:border-l-cat-violet-dark",
  red: "border-l-cat-red dark:border-l-cat-red-dark",
};

const TEXT_CLASSES: Record<CategoricalHue, string> = {
  blue: "text-cat-blue dark:text-cat-blue-dark",
  orange: "text-cat-orange dark:text-cat-orange-dark",
  aqua: "text-cat-aqua dark:text-cat-aqua-dark",
  yellow: "text-cat-yellow dark:text-cat-yellow-dark",
  magenta: "text-cat-magenta dark:text-cat-magenta-dark",
  green: "text-cat-green dark:text-cat-green-dark",
  violet: "text-cat-violet dark:text-cat-violet-dark",
  red: "text-cat-red dark:text-cat-red-dark",
};

const SOLID_CLASSES: Record<CategoricalHue, string> = {
  blue: "bg-cat-blue dark:bg-cat-blue-dark",
  orange: "bg-cat-orange dark:bg-cat-orange-dark",
  aqua: "bg-cat-aqua dark:bg-cat-aqua-dark",
  yellow: "bg-cat-yellow dark:bg-cat-yellow-dark",
  magenta: "bg-cat-magenta dark:bg-cat-magenta-dark",
  green: "bg-cat-green dark:bg-cat-green-dark",
  violet: "bg-cat-violet dark:bg-cat-violet-dark",
  red: "bg-cat-red dark:bg-cat-red-dark",
};

const RING_CLASSES: Record<CategoricalHue, string> = {
  blue: "focus:ring-cat-blue dark:focus:ring-cat-blue-dark",
  orange: "focus:ring-cat-orange dark:focus:ring-cat-orange-dark",
  aqua: "focus:ring-cat-aqua dark:focus:ring-cat-aqua-dark",
  yellow: "focus:ring-cat-yellow dark:focus:ring-cat-yellow-dark",
  magenta: "focus:ring-cat-magenta dark:focus:ring-cat-magenta-dark",
  green: "focus:ring-cat-green dark:focus:ring-cat-green-dark",
  violet: "focus:ring-cat-violet dark:focus:ring-cat-violet-dark",
  red: "focus:ring-cat-red dark:focus:ring-cat-red-dark",
};

export function accentBorderClass(hue: CategoricalHue): string {
  return BORDER_CLASSES[hue];
}

export function accentTextClass(hue: CategoricalHue): string {
  return TEXT_CLASSES[hue];
}

export function accentSolidClass(hue: CategoricalHue): string {
  return SOLID_CLASSES[hue];
}

export function accentRingClass(hue: CategoricalHue): string {
  return RING_CLASSES[hue];
}
