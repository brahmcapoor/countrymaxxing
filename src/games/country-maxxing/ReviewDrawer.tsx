import { useState } from "react";
import { countries } from "../../data/countries";
import { missCount, type TalliedItem } from "../../core/sessionTally";

// Keyed off the static dataset, not anything session-specific — every
// TalliedItem's cca3 is one of these, so a plain lookup map is enough to
// pull the capital back out for display without threading it through
// sessionTally itself (that stays generic across all four modes).
const countryByCca3 = new Map(countries.map((c) => [c.cca3, c]));

function tagsFor(item: TalliedItem): string[] {
  const misses = missCount(item);
  return [misses > 0 ? `missed ${misses}×` : null, item.gaveUp ? "gave up" : null].filter(
    (tag): tag is string => tag !== null,
  );
}

// The list + copy button, factored out so both the post-session drawer
// below and each play screen's mid-session "Review" panel (toggled from
// the top bar, same pattern as "Skipped") render identical content instead
// of duplicating the tag logic three times.
export function ReviewItemsList({ items }: { items: TalliedItem[] }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyList() {
    const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const lines = items.map((item) => {
      const capital = countryByCca3.get(item.cca3)?.capital;
      const suffix = [capital ? `capital: ${capital}` : null, ...tagsFor(item)].filter(Boolean).join(" · ");
      return `${item.flag} ${item.label}${suffix ? ` — ${suffix}` : ""}`;
    });
    const text = [`CountryMaxxing — Review (${date})`, `${items.length} to review`, "", ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <>
      <ul className="space-y-2">
        {items.map((item) => {
          const capital = countryByCca3.get(item.cca3)?.capital;
          const tags = tagsFor(item);
          return (
            <li key={item.cca3} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-ink dark:text-ink-dark">
                  {item.flag} {item.label}
                </span>
                <span className="shrink-0 text-xs text-cat-red dark:text-cat-red-dark">{tags.join(" · ")}</span>
              </div>
              {capital && (
                <p className="truncate text-xs text-ink-soft dark:text-ink-soft-dark">Capital: {capital}</p>
              )}
            </li>
          );
        })}
      </ul>
      <button
        onClick={copyList}
        className="mt-3 w-full cursor-pointer rounded-md bg-paper-card py-2 text-xs font-medium text-ink-soft ring-1 ring-inset ring-border transition-colors hover:text-ink dark:bg-paper-card-dark dark:text-ink-soft-dark dark:ring-border-dark dark:hover:text-ink-dark"
      >
        {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Couldn't copy" : "Copy list"}
      </button>
    </>
  );
}

// A collapsed-by-default drawer on the summary screen listing everything
// missed or given up on this session, worst-first. Deliberately separate
// from the mastered/missed region grid above it — that grid is "what
// happened," this is "what to go review."
export function ReviewDrawer({ items }: { items: TalliedItem[] }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="mt-6 text-left">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between rounded-md border border-border px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-ink/30 dark:border-border-dark dark:text-ink-dark dark:hover:border-ink-dark/30"
      >
        <span>Review ({items.length})</span>
        <span aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border p-4 dark:border-border-dark">
          <ReviewItemsList items={items} />
        </div>
      )}
    </div>
  );
}
