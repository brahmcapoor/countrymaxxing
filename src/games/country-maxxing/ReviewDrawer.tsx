import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { missCount, type TalliedItem } from "../../core/sessionTally";

// The list + copy button, factored out so both the post-session drawer
// below and each play screen's mid-session "Review" panel (toggled from
// the top bar, same pattern as "Skipped") render identical content instead
// of duplicating the tag logic three times.
export function ReviewItemsList({ items }: { items: TalliedItem[] }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyList() {
    const text = items.map((item) => item.label).join("\n");
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
      <ul className="space-y-1.5">
        {items.map((item) => {
          const misses = missCount(item);
          const tags = [misses > 0 ? `missed ${misses}×` : null, item.gaveUp ? "gave up" : null].filter(Boolean);
          return (
            <li key={item.cca3} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-ink dark:text-ink-dark">
                {item.flag} {item.label}
              </span>
              <span className="shrink-0 text-xs text-cat-red dark:text-cat-red-dark">{tags.join(" · ")}</span>
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
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-md border border-border p-4 dark:border-border-dark">
              <ReviewItemsList items={items} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
