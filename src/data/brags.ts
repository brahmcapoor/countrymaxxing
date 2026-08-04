// Shown only on a genuine celebration (session mastered / perfect quiz /
// named them all) — the app's only source of "personality" copy on a miss/
// win now that repeat-miss roasting was removed in favor of celebrating
// progress instead of ribbing weak spots.
const BRAG_LINES = [
  "Local guide status: unlocked.",
  "Customs waved you through without a second look.",
  "You've clearly seen a globe before.",
  "Somewhere, a geography teacher is proud.",
  "Certified: not lost.",
  "Diplomatic immunity, basically.",
  "Cartographers hate this one trick.",
  "You'd survive a pub quiz. A tough one.",
];

export function randomBrag(): string {
  return BRAG_LINES[Math.floor(Math.random() * BRAG_LINES.length)]!;
}
