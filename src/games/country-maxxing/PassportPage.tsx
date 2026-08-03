import { regions } from "../../data/countries";
import { getStamps } from "../../core/passport";

// Fixed per-slot rotation for the stamp graphics — a real customs stamp
// never lands perfectly square, but re-randomizing on every render would
// make the page jitter each time it's opened. Cycled by index instead of
// keyed to the region name, so it stays stable without needing a hash.
const STAMP_ROTATIONS = [-7, 5, -4, 8, -6, 3];

function formatStampDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function PassportPage({ onClose }: { onClose: () => void }) {
  const stamps = getStamps();
  const stampedCount = regions.filter((r) => r in stamps).length;

  return (
    <div className="isolate mx-auto my-8 max-w-xl rounded-[28px] border-[6px] border-double border-ink/20 bg-paper-card px-6 py-10 shadow-2xl dark:border-ink-dark/20 dark:bg-paper-card-dark">
      <button
        onClick={onClose}
        className="cursor-pointer text-sm text-ink-soft transition-colors hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
      >
        ← Back
      </button>

      <div className="mt-4 text-center">
        <h2 className="font-serif text-3xl font-bold text-ink dark:text-ink-dark">Passport</h2>
        <p className="font-label mt-1 text-xs uppercase tracking-[0.14em] text-ink-soft dark:text-ink-soft-dark">
          {stampedCount} / {regions.length} regions stamped
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {regions.map((region, i) => {
          const stampedAt = stamps[region];
          return (
            <div
              key={region}
              className="relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border px-4 py-4 dark:border-border-dark"
            >
              <div>
                <p className="font-serif text-lg font-semibold text-ink dark:text-ink-dark">{region}</p>
                <p className="mt-0.5 text-xs text-ink-soft dark:text-ink-soft-dark">
                  {stampedAt ? `Mastered ${formatStampDate(stampedAt)}` : "Not yet visited"}
                </p>
              </div>

              {stampedAt ? (
                <div
                  aria-hidden="true"
                  className="mix-blend-multiply dark:mix-blend-normal flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-[3px] border-double border-cat-red text-center text-cat-red dark:border-cat-red-dark dark:text-cat-red-dark"
                  style={{ transform: `rotate(${STAMP_ROTATIONS[i % STAMP_ROTATIONS.length]}deg)` }}
                >
                  <span className="font-label text-[9px] font-bold uppercase leading-tight tracking-wide">
                    Visited
                  </span>
                  <span className="text-[8px] font-medium leading-tight">
                    {new Date(stampedAt).getFullYear()}
                  </span>
                </div>
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-ink-soft/40 dark:border-border-dark dark:text-ink-soft-dark/40"
                >
                  <span className="text-lg">?</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-ink-soft dark:text-ink-soft-dark">
        A region gets stamped the first time you master it end to end — a Learn-mode session with everything
        right, or a perfect Quiz — in a single-region selection.
      </p>
    </div>
  );
}
