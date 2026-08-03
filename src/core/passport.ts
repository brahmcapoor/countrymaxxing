// One stamp per region, earned the first time a single-region session
// finishes 100% correct (Learn mode's natural completion, or a perfect Quiz
// score) — a lightweight, separate achievement layer on top of the
// per-country stats in stats.ts, not derived from it. Kept intentionally
// coarse: one stamp per region, not per game mode, so it stays an
// achievable trophy case rather than a second mistake tracker.
const STORAGE_KEY = "countrymaxxing:passport:v1";

type PassportStore = Record<string, number>; // region -> first-stamped timestamp (ms)

function readStore(): PassportStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PassportStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: PassportStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort — losing a stamp on write failure isn't worth surfacing.
  }
}

export function getStamps(): PassportStore {
  return readStore();
}

export function isStamped(region: string): boolean {
  return region in readStore();
}

// Idempotent — a region already stamped keeps its original date rather than
// refreshing on every later perfect run.
export function stampRegion(region: string): void {
  const store = readStore();
  if (region in store) return;
  store[region] = Date.now();
  writeStore(store);
}
