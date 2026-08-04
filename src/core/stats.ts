const STORAGE_KEY = "countrymaxxing:stats:v1";

interface ItemStat {
  attempts: number;
  misses: number;
  lastAttemptAt: number;
  // Exponentially recency-weighted miss rate (0 = always correct lately, 1 =
  // always missed lately) — separate from the plain lifetime `misses`
  // count, which weights a miss from a year ago the same as one from just
  // now. EMA is what "Focus on weak spots" actually filters on; see isWeak()
  // in engine.ts.
  emaMiss: number;
}

type StatsStore = Record<string, ItemStat>;

// Recent attempts dominate the EMA roughly 3x an old one — chosen so a
// handful of consecutive correct answers can pull an item out of "weak"
// within the same session, rather than needing to outweigh a whole history
// of misses one at a time.
const EMA_ALPHA = 1 / 3;

function load(): StatsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(store: StatsStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function fullKey(namespace: string, itemKey: string): string {
  return `${namespace}::${itemKey}`;
}

// Stats recorded before emaMiss existed don't have it — back-fill from the
// lifetime ratio so a long history isn't discarded outright, it just starts
// decaying toward recent performance from here on.
function emaMissOf(stat: ItemStat): number {
  return stat.emaMiss ?? (stat.attempts > 0 ? stat.misses / stat.attempts : 0.5);
}

export function recordAttempt(namespace: string, itemKey: string, correct: boolean): void {
  const store = load();
  const key = fullKey(namespace, itemKey);
  const existing = store[key] ?? { attempts: 0, misses: 0, lastAttemptAt: 0, emaMiss: 0.5 };
  const priorEmaMiss = emaMissOf(existing);
  store[key] = {
    attempts: existing.attempts + 1,
    misses: existing.misses + (correct ? 0 : 1),
    lastAttemptAt: Date.now(),
    emaMiss: EMA_ALPHA * (correct ? 0 : 1) + (1 - EMA_ALPHA) * priorEmaMiss,
  };
  save(store);
}

export function getStat(
  namespace: string,
  itemKey: string,
): { attempts: number; misses: number; emaMiss: number } | null {
  const stat = load()[fullKey(namespace, itemKey)];
  return stat ? { attempts: stat.attempts, misses: stat.misses, emaMiss: emaMissOf(stat) } : null;
}

// Laplace-smoothed miss rate: an untried item starts at 0.5 (unknown) rather
// than 0, so new items still show up in weighted selection alongside misses.
export function getMissWeight(namespace: string, itemKey: string): number {
  const stat = load()[fullKey(namespace, itemKey)];
  if (!stat) return 0.5;
  return (stat.misses + 1) / (stat.attempts + 2);
}

export function pickWeighted<T>(items: T[], weightFn: (item: T) => number): T {
  const weights = items.map(weightFn);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let target = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    target -= weights[i]!;
    if (target <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
