import { useMemo, useRef, useState, type FormEvent } from "react";
import { countries, type Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { SoundToggle } from "../../components/SoundToggle";
import { DarkModeToggle } from "../../components/DarkModeToggle";
import { accentSolidClass } from "../../core/palette";
import { playCorrect, playIncorrect } from "../../core/sound";
import {
  nameAllCandidates,
  nameAllLabel,
  nameAllListLabel,
  recordNameAllAttempt,
  type NameAllSubject,
} from "./engine";
import { isCloseMatch, isExactMatch } from "../../core/fuzzyMatch";
import { MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import { formatCountdown, useCountdown } from "../../core/useCountdown";

const ACCENT = "red"; // matches CountryMaxxing.tsx's accent

// A stand-in for a not-yet-found entry — a hatched bar rather than dots or
// text, echoing Terra Incognita's "▧" unknown-territory swatch elsewhere in
// this game rather than reading as an ellipsis/loading indicator.
function MissingSwatch({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-2.5 w-full max-w-14 rounded-[2px] text-ink-soft/35 dark:text-ink-soft-dark/35 ${className ?? ""}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, currentColor 0, currentColor 1.5px, transparent 1.5px, transparent 5px)",
      }}
    />
  );
}

export function NameAllPlay({
  pool,
  subject,
  timeLimitSeconds,
  onExit,
}: {
  pool: Country[];
  subject: NameAllSubject;
  timeLimitSeconds: number | null;
  onExit: (result: { found: Country[]; missed: Country[] } | null) => void;
}) {
  const [foundCca3s, setFoundCca3s] = useState<Set<string>>(new Set());
  const [pinsRevealed, setPinsRevealed] = useState(false);
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<{ kind: "already" | "unknown" | "out-of-pool"; text: string } | null>(
    null,
  );
  const [showMissing, setShowMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const remaining = useMemo(() => pool.filter((c) => !foundCca3s.has(c.cca3)), [pool, foundCca3s]);
  const found = useMemo(() => pool.filter((c) => foundCca3s.has(c.cca3)), [pool, foundCca3s]);
  // Late-game assist: once down to the last few, "Drop pins" marks each
  // remaining country's capital on the map so they're at least locatable
  // even if the shape alone isn't ringing a bell. One-way once triggered —
  // remaining only ever shrinks in this mode, so there's no need to hide
  // pins again as the count changes.
  const canDropPins = remaining.length > 0 && remaining.length < 5;
  const hintPins = useMemo(
    () => (pinsRevealed ? new Map(remaining.map((c) => [c.ccn3, c.capitalLatLng] as const)) : undefined),
    [pinsRevealed, remaining],
  );
  const filledCcn3s = useMemo(() => new Set(found.map((c) => c.ccn3)), [found]);
  // Zoom to the whole session pool (not just what's found so far) so the
  // map's framing stays stable as items get filled in.
  const poolCcn3s = useMemo(() => new Set(pool.map((c) => c.ccn3)), [pool]);
  // Only mark already-found capitals — showing all of them upfront would
  // hand out free hints for the ones still to find. And only in "capitals"
  // mode — when naming countries, the capital markers aren't part of what's
  // being tested and just add visual noise.
  const capitalDots = useMemo(
    () => (subject === "capitals" ? new Map(found.map((c) => [c.ccn3, c.capitalLatLng])) : undefined),
    [found, subject],
  );
  // Countries whose real shape isn't usefully renderable (missing entirely,
  // or too spatially sparse — see mapCoverage.ts) get a marker at their
  // capital instead, so being found still shows up on the map.
  const pointCountries = useMemo(
    () =>
      new Map(
        pool.filter((c) => MAP_HARD_TO_RENDER.has(c.cca3)).map((c) => [c.ccn3, c.capitalLatLng] as const),
      ),
    [pool],
  );

  // Grouped by region, found and missing kept separate per region — missing
  // renders as blank placeholders (only when showMissing is on) so a region
  // with tiny/easy-to-forget countries still shows "3 more here" without
  // spoiling which three.
  const groupedByRegion = useMemo(() => {
    const groups = new Map<string, { found: Country[]; missing: Country[] }>();
    for (const c of pool) {
      let entry = groups.get(c.region);
      if (!entry) {
        entry = { found: [], missing: [] };
        groups.set(c.region, entry);
      }
      if (foundCca3s.has(c.cca3)) entry.found.push(c);
      else entry.missing.push(c);
    }
    for (const entry of groups.values()) {
      entry.found.sort((a, b) => nameAllLabel(a, subject).localeCompare(nameAllLabel(b, subject)));
      entry.missing.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [pool, foundCca3s, subject]);

  // Hovering the map shows a country name — but only when that can't hand
  // over the answer. "Capitals" mode is always safe (the country name isn't
  // the thing being guessed); "Countries" mode only reveals already-found
  // ones, so an unfound country stays a mystery until you name it.
  const labelsByCcn3 = useMemo(() => {
    const map = new Map<string, string>();
    pool.forEach((c) => {
      if (subject === "capitals" || foundCca3s.has(c.cca3)) map.set(c.ccn3, c.name);
    });
    return map;
  }, [pool, subject, foundCca3s]);

  function finish() {
    const missed = pool.filter((c) => !foundCca3s.has(c.cca3));
    missed.forEach((c) => recordNameAllAttempt(c, subject, false));
    found.forEach((c) => recordNameAllAttempt(c, subject, true));
    onExit({ found, missed });
  }

  const secondsLeft = useCountdown(timeLimitSeconds, finish);

  function markFound(match: Country) {
    playCorrect();
    const nextFound = new Set(foundCca3s).add(match.cca3);
    setFoundCca3s(nextFound);
    setInput("");
    setHint(null);
    if (nextFound.size === pool.length) {
      const missed: Country[] = [];
      pool.forEach((c) => recordNameAllAttempt(c, subject, true));
      onExit({ found: pool, missed });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    // An exact match against a still-remaining country always wins, even
    // over a fuzzy "already found" hit — with 197 candidates in play, some
    // pairs (e.g. Zambia/Gambia) sit one typo apart, and a fully-typed exact
    // name shouldn't get shadowed by fuzzy tolerance meant for actual typos.
    const exactMatch = remaining.find((c) => isExactMatch(trimmed, nameAllCandidates(c, subject)));
    if (exactMatch) {
      markFound(exactMatch);
      inputRef.current?.focus();
      return;
    }

    const alreadyFound = found.find((c) => isCloseMatch(trimmed, nameAllCandidates(c, subject)));
    if (alreadyFound) {
      setHint({ kind: "already", text: `Already got ${nameAllLabel(alreadyFound, subject)}.` });
      setInput("");
      inputRef.current?.focus();
      return;
    }

    const match = remaining.find((c) => isCloseMatch(trimmed, nameAllCandidates(c, subject)));
    if (match) {
      markFound(match);
      inputRef.current?.focus();
      return;
    }

    // A real country/capital, just not one of the ones in play — e.g. typing
    // "France" while filtered to Asia. Distinct from a genuine typo/unknown:
    // the user got it right, this pool just isn't asking about it.
    const outOfPool = countries.find(
      (c) => !pool.some((p) => p.cca3 === c.cca3) && isCloseMatch(trimmed, nameAllCandidates(c, subject)),
    );
    if (outOfPool) {
      setHint({
        kind: "out-of-pool",
        text: `${nameAllLabel(outOfPool, subject)} is right, but not in this selection.`,
      });
      setInput("");
      inputRef.current?.focus();
      return;
    }

    playIncorrect();
    setHint({ kind: "unknown", text: "Not finding that one — try another spelling?" });
    inputRef.current?.focus();
  }

  return (
    <div className="animate-[swoop-in_0.5s_ease-out]">
      {/* Full viewport height — see the matching comment in PromptAndAnswerPlay.tsx
          about the coupling to App.tsx's (currently absent) shelf header. */}
      <div className="relative h-dvh bg-paper dark:bg-paper-dark">
        <WorldMap
          filledCcn3s={filledCcn3s}
          focusCcn3s={poolCcn3s}
          labelsByCcn3={labelsByCcn3}
          capitalDots={capitalDots}
          pointCountries={pointCountries}
          hintPins={hintPins}
          className="h-full w-full portrait:w-auto"
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 text-sm">
          <button
            onClick={() => onExit(null)}
            className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink-soft shadow-sm backdrop-blur hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
          >
            ← End session
          </button>
          <div className="flex items-center gap-2">
            <DarkModeToggle />
            <SoundToggle />
            {canDropPins && (
              <button
                type="button"
                onClick={() => setPinsRevealed(true)}
                disabled={pinsRevealed}
                title="Drop a pin on each remaining country"
                className={`pointer-events-auto rounded-full px-3 py-1.5 shadow-sm backdrop-blur transition-colors ${
                  pinsRevealed
                    ? "bg-cat-violet/15 text-cat-violet dark:bg-cat-violet-dark/20 dark:text-cat-violet-dark"
                    : "cursor-pointer bg-paper-card/95 text-ink-soft hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
                }`}
              >
                📍 {pinsRevealed ? "Pins dropped" : "Drop pins"}
              </button>
            )}
            {timeLimitSeconds !== null && (
              <span
                className={`pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 shadow-sm backdrop-blur dark:bg-paper-card-dark/95 ${
                  secondsLeft <= 10 ? "text-cat-red dark:text-cat-red-dark" : "text-ink dark:text-ink-dark"
                }`}
              >
                ⏱ {formatCountdown(secondsLeft)}
              </span>
            )}
            <span className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink shadow-sm backdrop-blur dark:bg-paper-card-dark/95 dark:text-ink-dark">
              {found.length} / {pool.length} found
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 px-4">
          <form onSubmit={handleSubmit} className="pointer-events-auto relative w-full max-w-md">
            {hint && (
              <p
                className={`pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 rounded-full bg-paper-card/90 px-3 py-1 text-center text-sm shadow-sm backdrop-blur dark:bg-paper-card-dark/90 ${
                  hint.kind === "already"
                    ? "text-ink-soft dark:text-ink-soft-dark"
                    : hint.kind === "out-of-pool"
                      ? "text-cat-yellow dark:text-cat-yellow-dark"
                      : "text-cat-red dark:text-cat-red-dark"
                }`}
              >
                {hint.text}
              </p>
            )}
            <input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={subject === "countries" ? "Type a country" : "Type a capital"}
              className={`w-full rounded-full border border-border bg-paper-card/95 px-5 py-3 text-center text-lg text-ink shadow-lg outline-none backdrop-blur focus:ring-2 focus:ring-cat-blue dark:border-border-dark dark:bg-paper-card-dark/95 dark:text-ink-dark dark:focus:ring-cat-red-dark ${hint?.kind === "unknown" ? "shake-once" : ""}`}
            />
          </form>

          <button
            type="button"
            onClick={() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            aria-label="Jump to found countries list"
            title="Jump to found countries list"
            className="pointer-events-auto flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper-card/95 text-ink shadow-lg backdrop-blur transition-transform hover:scale-105 dark:bg-paper-card-dark/95 dark:text-ink-dark"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={listRef} className="border-t border-border px-4 py-3 dark:border-border-dark">
        <button
          onClick={finish}
          className={`mx-auto block w-full max-w-lg rounded-md py-3 font-medium text-white transition-opacity hover:opacity-90 ${accentSolidClass(ACCENT)}`}
        >
          Finish — {remaining.length} left
        </button>

        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
            Found so far
          </p>
          <button
            type="button"
            onClick={() => setShowMissing((v) => !v)}
            className="cursor-pointer text-xs text-ink-soft underline decoration-border underline-offset-2 transition-colors hover:text-ink dark:text-ink-soft-dark dark:decoration-border-dark dark:hover:text-ink-dark"
          >
            {showMissing ? "Hide missing" : "Show missing"}
          </button>
        </div>

        <div className="mt-2 space-y-4">
          {groupedByRegion
            .filter(([, { found: f, missing }]) => f.length > 0 || (showMissing && missing.length > 0))
            .map(([region, { found: regionFound, missing }]) => (
              <div key={region}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
                  {region} ({regionFound.length}
                  {showMissing ? ` / ${regionFound.length + missing.length}` : ""})
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {regionFound.map((c) => (
                    <div key={c.cca3} className="truncate text-sm text-ink dark:text-ink-dark">
                      {c.flag} {nameAllListLabel(c, subject)}
                    </div>
                  ))}
                  {showMissing &&
                    missing.map((c) =>
                      subject === "capitals" ? (
                        <div key={c.cca3} className="group relative flex h-5 items-center">
                          <MissingSwatch className="cursor-help" />
                          <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-paper opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-ink-dark dark:text-paper-dark">
                            {c.flag} {c.name}
                          </div>
                        </div>
                      ) : (
                        <div key={c.cca3} className="flex h-5 items-center">
                          <MissingSwatch />
                        </div>
                      ),
                    )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
