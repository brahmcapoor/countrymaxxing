import { useRef } from "react";

// Per-item record of every attempt this session, in the order they
// happened — the raw material for the summary screen's round breakdown,
// review drawer, and difficulty-tinted map. Keyed by cca3 (country
// identity) rather than a mode-specific question key: a country that comes
// up as both "country → capital" and "capital → country" in the same One
// Stop session is still one thing to review, not two.
export interface TalliedItem {
  cca3: string;
  label: string;
  flag: string;
  attempts: boolean[];
  gaveUp: boolean;
}

export interface SessionTally {
  record(item: { cca3: string; label: string; flag: string }, correct: boolean, gaveUp?: boolean): void;
  getItems(): TalliedItem[];
}

// A plain mutable ref, not reactive state — every play screen calls
// record() far more often (every attempt) than anything needs to re-render
// off of it; the summary screen only ever reads the final snapshot once,
// via getItems() at onExit.
export function useSessionTally(): SessionTally {
  const itemsRef = useRef(new Map<string, TalliedItem>());

  function record(item: { cca3: string; label: string; flag: string }, correct: boolean, gaveUp = false): void {
    const existing = itemsRef.current.get(item.cca3);
    const entry: TalliedItem = existing ?? { ...item, attempts: [], gaveUp: false };
    entry.attempts = [...entry.attempts, correct];
    if (gaveUp) entry.gaveUp = true;
    itemsRef.current.set(item.cca3, entry);
  }

  function getItems(): TalliedItem[] {
    return Array.from(itemsRef.current.values());
  }

  return { record, getItems };
}

// Groups by attempt index rather than by queue-traversal order — robust to
// requeueAfterMiss's tight gap (a few questions later, not "next lap
// through the whole deck"), where a literal pass boundary isn't a coherent
// concept anymore. "Round 1: 40/50" means 40 of the 50 items asked were
// right on their first attempt; "Round 2: 8/10" means 8 of the 10 items
// that needed a second attempt got it right that time.
export function roundBreakdown(items: TalliedItem[]): { round: number; correct: number; total: number }[] {
  const maxAttempts = items.reduce((max, item) => Math.max(max, item.attempts.length), 0);
  const rounds: { round: number; correct: number; total: number }[] = [];
  for (let i = 0; i < maxAttempts; i++) {
    const atThisRound = items.filter((item) => item.attempts.length > i);
    const correct = atThisRound.filter((item) => item.attempts[i]).length;
    rounds.push({ round: i + 1, correct, total: atThisRound.length });
  }
  return rounds;
}

// Anything given up on, or missed at least once — worst (most misses)
// first, so the items most worth reviewing float to the top.
export function reviewList(items: TalliedItem[]): TalliedItem[] {
  return items
    .filter((item) => item.gaveUp || item.attempts.some((a) => !a))
    .sort((a, b) => missCount(b) - missCount(a));
}

export function missCount(item: TalliedItem): number {
  return item.attempts.filter((a) => !a).length;
}
