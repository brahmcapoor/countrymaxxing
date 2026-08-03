const STORAGE_KEY = "countrymaxxing:stats:v1";

interface ItemStat {
  attempts: number;
  misses: number;
  lastAttemptAt: number;
}

type StatsStore = Record<string, ItemStat>;

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

export function recordAttempt(namespace: string, itemKey: string, correct: boolean): void {
  const store = load();
  const key = fullKey(namespace, itemKey);
  const existing = store[key] ?? { attempts: 0, misses: 0, lastAttemptAt: 0 };
  store[key] = {
    attempts: existing.attempts + 1,
    misses: existing.misses + (correct ? 0 : 1),
    lastAttemptAt: Date.now(),
  };
  save(store);
}

export function getStat(namespace: string, itemKey: string): { attempts: number; misses: number } | null {
  const stat = load()[fullKey(namespace, itemKey)];
  return stat ? { attempts: stat.attempts, misses: stat.misses } : null;
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
