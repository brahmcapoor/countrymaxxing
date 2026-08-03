// Shown only when the same item has been missed repeatedly — see
// ROAST_MISS_THRESHOLD in engine.ts. Not general feedback copy variety.
const ROAST_TEMPLATES = [
  "{name}. Again. We've talked about this.",
  "{name} really has it out for you, huh?",
  "You and {name} have a complicated relationship.",
  "Third time isn't the charm — it's {name}, hi again.",
  "{name} is living rent-free in your blind spot.",
  "At this point {name} owes YOU money.",
  "Plot twist: it's still {name}.",
  "{name}. You know this one. You don't know this one.",
  "Somewhere, a geography teacher felt that.",
  "{name} is starting to feel like a bit.",
];

export function roastFor(name: string): string {
  const template = ROAST_TEMPLATES[Math.floor(Math.random() * ROAST_TEMPLATES.length)]!;
  return template.replace("{name}", name);
}
