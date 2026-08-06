import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { countries, regions, type Country } from "../../data/countries";
import { accentSolidClass, accentTextClass, type CategoricalHue } from "../../core/palette";
import { Confetti } from "../../components/Confetti";
import { DarkModeToggle } from "../../components/DarkModeToggle";
import { SlideToDepart } from "../../components/SlideToDepart";
import { playFanfare, playStampThunk } from "../../core/sound";
import { stampRegion } from "../../core/passport";
import { randomTagline } from "../../data/taglines";
import { randomBrag } from "../../data/brags";
import { NameAllPlay } from "./NameAllPlay";
import { MapIdentifyPlay, type MapIdentifyResult } from "./MapIdentifyPlay";
import { PromptAndAnswerPlay, type PromptAndAnswerResult } from "./PromptAndAnswerPlay";
import { BorderPlay, type BorderResult } from "./BorderPlay";
import { SizeComparePlay, type SizeCompareResult } from "./SizeComparePlay";
import { PassportPage } from "./PassportPage";
import { ReviewDrawer } from "./ReviewDrawer";
import { ReviewMap } from "./ReviewMap";
import { reviewList, roundBreakdown, type CategoryBreakdownEntry, type TalliedItem } from "../../core/sessionTally";
import {
  borderEligiblePool,
  nameAllListLabel,
  poolForRegions,
  sizeCompareEligiblePool,
  weakPoolFor,
  weakPoolForBorders,
  weakPoolForMapIdentify,
  weakPoolForNameAll,
  weakPoolForSizeCompare,
  type BorderQuestionTypeSetting,
  type DirectionSetting,
  type NameAllSubject,
  type SessionType,
} from "./engine";

const ACCENT = "red"; // CountryMaxxing is slot 1 in the top-level game registry
const SPEED_ROUND_OPTIONS = [600, 900, 1800] as const; // 10, 15, 30 minutes

type Format = "prompt-answer" | "name-all" | "map-identify" | "borders" | "size-compare";

// Yellow reads poorly with white text at any lightness we'd want for a solid
// fill — everything else in the categorical set is dark/saturated enough.
const DARK_TEXT_ON_FILL: ReadonlySet<CategoricalHue> = new Set(["yellow"]);

const FORMAT_OPTIONS: { id: Format; label: string; hint: string; glyph: string; hue: CategoricalHue }[] = [
  { id: "name-all", label: "Manifest", hint: "You versus the atlas.", glyph: "☰", hue: "yellow" },
  { id: "prompt-answer", label: "One Stop", hint: "One country at a time.", glyph: "①", hue: "red" },
  {
    id: "map-identify",
    label: "Terra Incognita",
    hint: "Identify the highlighted country on the map.",
    glyph: "▧",
    hue: "aqua",
  },
  {
    id: "borders",
    label: "Frontiers",
    hint: "Name what borders what.",
    glyph: "◫",
    hue: "violet",
  },
  {
    id: "size-compare",
    label: "It's Relative",
    hint: "Guess the true scale.",
    glyph: "⚖",
    hue: "green",
  },
];

const PANEL_TRANSITION = { duration: 0.24, ease: [0.22, 1, 0.36, 1] } as const;

interface NameAllResult {
  found: Country[];
  missed: Country[];
}

// Display labels for each mode's own category-breakdown keys (see
// CategoryBreakdownEntry) — Manifest has no entry since it doesn't produce
// one (free recall doesn't fit the per-item-attempt model the others share).
const CATEGORY_LABELS: Record<Format, Record<string, string>> = {
  "prompt-answer": { "country-to-capital": "Country → Capital", "capital-to-country": "Capital → Country" },
  "map-identify": { country: "Country ID", capital: "Capital recall" },
  borders: {
    "name-neighbors": "Name the neighbors",
    "reverse-lookup": "Who borders these?",
    "longest-shortest": "Longest / shortest",
  },
  // Size Compare has only one question shape (unlike the others' direction/
  // skill/type axes), so its breakdown is by the candidate's region instead
  // — an identity mapping, since the category key is already the region name.
  "size-compare": Object.fromEntries(regions.map((r) => [r, r])),
  "name-all": {},
};

// A small customs-declaration-style checkbox — used for every yes/no toggle
// on the setup screen instead of a bare native checkbox.
function DeclareCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-ink dark:text-ink-dark">
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-border transition-colors duration-200 dark:border-border-dark">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span className="pointer-events-none absolute inset-0 scale-75 rounded bg-cat-aqua opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100 dark:bg-cat-aqua-dark" />
        <span className="pointer-events-none relative scale-75 text-xs font-bold text-white opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100">
          ✓
        </span>
      </span>
      <span>{children}</span>
    </label>
  );
}

export function CountryMaxxing() {
  const [phase, setPhase] = useState<"setup" | "play" | "summary" | "passport">("setup");
  // One picked per mount, not per render — re-rolling on every keystroke in
  // the setup form would be distracting rather than a nice surprise.
  const [tagline] = useState(randomTagline);
  const [format, setFormat] = useState<Format>("name-all");
  const [sessionType, setSessionType] = useState<SessionType>("learn");
  const [directionSetting, setDirectionSetting] = useState<DirectionSetting>("mixed");
  const [subject, setSubject] = useState<NameAllSubject>("countries");
  const [askCapital, setAskCapital] = useState(false);
  const [borderTypeSetting, setBorderTypeSetting] = useState<BorderQuestionTypeSetting>("mixed");
  const [borderShowMap, setBorderShowMap] = useState(true);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set(regions));
  const [focusOnWeakSpots, setFocusOnWeakSpots] = useState(false);
  const [letterHints, setLetterHints] = useState(false);
  const [speedRoundEnabled, setSpeedRoundEnabled] = useState(false);
  const [speedRoundSeconds, setSpeedRoundSeconds] = useState<number>(600);

  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [nameAllResult, setNameAllResult] = useState<NameAllResult | null>(null);
  // Set only by "Learn what I missed" on a Quiz summary — overrides the
  // region/weak-spot pool below with just the countries that session got
  // wrong, for one Learn-mode pass. Cleared whenever the player heads back
  // to the setup screen, so a stale subset never leaks into their next
  // normal session.
  const [customPool, setCustomPool] = useState<Country[] | null>(null);
  // Populated only on an early "Give up" in Learn mode — Quiz mode's summary
  // is already just the score, and a natural Learn-mode completion means
  // nothing is left, so this only ever matters for the give-up case.
  const [remainingOnGiveUp, setRemainingOnGiveUp] = useState<
    { cca3: string; region: string; label: string; flag: string }[] | null
  >(null);
  // Populated by every format except Manifest (free recall doesn't fit the
  // same per-item-attempt model) — feeds the round breakdown and review
  // drawer below the mastered/missed grid on the shared summary screen.
  const [sessionTally, setSessionTally] = useState<TalliedItem[]>([]);
  // Set by whichever mode just finished (see CATEGORY_LABELS) — the format
  // in state at render time tells the summary screen which label set to use.
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownEntry[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [bragLine, setBragLine] = useState<string | null>(null);

  const regionPool = poolForRegions(selectedRegions);
  // Reads localStorage stats, so it's computed fresh each render rather than
  // memoized — a session just finished can change which items count as weak.
  const weakPool =
    format === "prompt-answer"
      ? weakPoolFor(regionPool, directionSetting)
      : format === "map-identify"
        ? weakPoolForMapIdentify(regionPool, askCapital)
        : format === "borders"
          ? weakPoolForBorders(regionPool, borderTypeSetting)
          : format === "size-compare"
            ? weakPoolForSizeCompare(regionPool)
            : weakPoolForNameAll(regionPool, subject);
  // Name All is free recall — there's no per-item prompt to have gotten
  // "wrong," so a session-completion miss isn't the same signal "focus on
  // weak spots" means for the other two modes. Don't apply it here, even if
  // the checkbox was left checked from a different format.
  const pool = customPool
    ? // Learn-what-I-missed already ran through borderEligiblePool/
      // sizeCompareEligiblePool once (every item in it was actually asked
      // last session), but reapplying it here costs nothing and keeps this
      // the single source of truth for "how many questions this session can
      // contain."
      format === "borders"
      ? borderEligiblePool(customPool, borderTypeSetting)
      : format === "size-compare"
        ? sizeCompareEligiblePool(customPool)
        : customPool
    : focusOnWeakSpots && format !== "name-all"
      ? weakPool
      : format === "borders"
        ? // Border mode silently skips countries the current type setting
          // can't ask about (islands have no neighbors; a country with only
          // one neighbor can't support "longest/shortest"). Filtering here —
          // not just inside BorderPlay's own queue-building — keeps
          // pool.length (the Depart button's count, and the give-up
          // summary's mastered/missed math) honest about how many questions
          // this session can actually contain.
          borderEligiblePool(regionPool, borderTypeSetting)
        : format === "size-compare"
          ? // Same reasoning as borders above — Tuvalu/Kiribati can't render
            // a usable silhouette, so pool.length needs to already exclude
            // them for the Depart count and give-up mastered/missed math to
            // stay honest about what this session can actually ask.
            sizeCompareEligiblePool(regionPool)
          : regionPool;
  // Speed round is Name All only — "how many can you name in 60 seconds" is
  // a natural race-the-clock shape. Prompt & Answer and Map Identify don't
  // fit as cleanly: Learn mode is "loop until you get everything right,"
  // which a hard cutoff undercuts, and Quiz mode there is already a
  // self-paced single pass rather than a race.
  const timeLimitSeconds = format === "name-all" && speedRoundEnabled ? speedRoundSeconds : null;

  const nameAllWin = format === "name-all" && !!nameAllResult && nameAllResult.missed.length === 0;
  const masteryWin =
    format !== "name-all" && sessionType === "learn" && (!remainingOnGiveUp || remainingOnGiveUp.length === 0);
  const perfectQuizWin =
    format !== "name-all" && sessionType === "quiz" && score.total > 0 && score.correct === score.total;
  const isCelebration = phase === "summary" && (nameAllWin || masteryWin || perfectQuizWin);

  useEffect(() => {
    if (!isCelebration) return;
    playFanfare();
    setCelebrate(true);
    setBragLine(randomBrag());
    const timeout = setTimeout(() => setCelebrate(false), 2600);
    return () => clearTimeout(timeout);
  }, [isCelebration]);

  // Only a single-region selection maps cleanly onto one passport stamp —
  // a mixed-region session finishing 100% doesn't tell us which region (if
  // any) was actually mastered end to end.
  function maybeStampPassport() {
    if (selectedRegions.size !== 1) return;
    const [region] = selectedRegions;
    if (region) stampRegion(region);
  }

  function toggleRegion(region: string) {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }

  // A brief pause after the slide-to-depart handle snaps to the end, so its
  // own snap animation is visible before the screen changes underneath it.
  const DEPART_SNAP_MS = 220;

  function startSession() {
    playStampThunk();
    setTimeout(() => {
      setRemainingOnGiveUp(null);
      setPhase("play");
    }, DEPART_SNAP_MS);
  }

  // Restarts with the exact settings/pool just used, skipping the trip back
  // through the setup screen — the play components fully remount (this phase
  // change unmounts the summary tree and mounts a fresh one), so state like
  // the shuffled queue and score are already guaranteed to reset.
  function playAgain() {
    playStampThunk();
    setScore({ correct: 0, total: 0 });
    setNameAllResult(null);
    setRemainingOnGiveUp(null);
    setSessionTally([]);
    setCategoryBreakdown([]);
    setPhase("play");
  }

  function backToSetup() {
    setCustomPool(null);
    setPhase("setup");
  }

  // Only reachable from a Quiz summary (the button is gated on
  // sessionType === "quiz") — takes whatever this session's ReviewDrawer is
  // showing and starts a fresh Learn-mode pass over just those countries.
  function learnMissed() {
    const missedCca3s = new Set(reviewList(sessionTally).map((item) => item.cca3));
    const missedCountries = countries.filter((c) => missedCca3s.has(c.cca3));
    if (missedCountries.length === 0) return;
    playStampThunk();
    setCustomPool(missedCountries);
    setSessionType("learn");
    setScore({ correct: 0, total: 0 });
    setRemainingOnGiveUp(null);
    setSessionTally([]);
    setCategoryBreakdown([]);
    setPhase("play");
  }

  function handleNameAllExit(result: NameAllResult | null) {
    if (!result) {
      backToSetup();
      return;
    }
    setNameAllResult(result);
    setPhase("summary");
    playStampThunk();
    if (result.missed.length === 0) maybeStampPassport();
  }

  function handleMapIdentifyExit(result: MapIdentifyResult | null) {
    if (!result) {
      backToSetup();
      return;
    }
    setScore(result);
    setRemainingOnGiveUp(result.remaining ?? null);
    setSessionTally(result.sessionTally);
    setCategoryBreakdown(result.skillBreakdown);
    setPhase("summary");
    playStampThunk();
    const success =
      sessionType === "learn" ? !result.remaining || result.remaining.length === 0 : result.correct === result.total;
    if (success) maybeStampPassport();
  }

  function handlePromptAndAnswerExit(result: PromptAndAnswerResult | null) {
    if (!result) {
      backToSetup();
      return;
    }
    setScore(result);
    setRemainingOnGiveUp(result.remaining ?? null);
    setSessionTally(result.sessionTally);
    setCategoryBreakdown(result.directionBreakdown);
    setPhase("summary");
    playStampThunk();
    const success =
      sessionType === "learn" ? !result.remaining || result.remaining.length === 0 : result.correct === result.total;
    if (success) maybeStampPassport();
  }

  function handleBorderExit(result: BorderResult | null) {
    if (!result) {
      backToSetup();
      return;
    }
    setScore(result);
    setRemainingOnGiveUp(result.remaining ?? null);
    setSessionTally(result.sessionTally);
    setCategoryBreakdown(result.typeBreakdown);
    setPhase("summary");
    playStampThunk();
    const success =
      sessionType === "learn" ? !result.remaining || result.remaining.length === 0 : result.correct === result.total;
    if (success) maybeStampPassport();
  }

  function handleSizeCompareExit(result: SizeCompareResult | null) {
    if (!result) {
      backToSetup();
      return;
    }
    setScore(result);
    setRemainingOnGiveUp(result.remaining ?? null);
    setSessionTally(result.sessionTally);
    setCategoryBreakdown(result.regionBreakdown);
    setPhase("summary");
    playStampThunk();
    const success =
      sessionType === "learn" ? !result.remaining || result.remaining.length === 0 : result.correct === result.total;
    if (success) maybeStampPassport();
  }

  if (phase === "summary" && format === "name-all" && nameAllResult) {
    const { found, missed } = nameAllResult;
    // One combined region-grouped grid instead of a separate "you missed"
    // pill list — found and missed items sit in the same place they would
    // have during play, missed ones just revealed and marked instead of
    // hatched-out, so reviewing a session reads the same way as playing it.
    const missedIds = new Set(missed.map((c) => c.cca3));
    const summaryGroups = new Map<string, { c: Country; missed: boolean }[]>();
    for (const c of [...found, ...missed]) {
      const entry = { c, missed: missedIds.has(c.cca3) };
      const list = summaryGroups.get(c.region);
      if (list) list.push(entry);
      else summaryGroups.set(c.region, [entry]);
    }
    for (const list of summaryGroups.values()) {
      // Found first (alphabetical among themselves), then missed — not one
      // interleaved alphabetical list — so the found ones read as a clean
      // "here's what you got" group before the red "here's what you missed."
      list.sort((a, b) => {
        if (a.missed !== b.missed) return a.missed ? 1 : -1;
        return nameAllListLabel(a.c, subject).localeCompare(nameAllListLabel(b.c, subject));
      });
    }
    const sortedSummaryGroups = Array.from(summaryGroups.entries()).sort(([a], [b]) => a.localeCompare(b));

    return (
      <motion.div
        key="summary-name-all"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PANEL_TRANSITION}
        className="mx-auto max-w-2xl px-4 text-center"
      >
        <Confetti active={celebrate} />
        <p className="font-serif text-2xl text-ink dark:text-ink-dark">
          {missed.length === 0 ? "Named them all! 🎉" : `${found.length} / ${found.length + missed.length} found`}
        </p>
        {missed.length === 0 && bragLine && (
          <p className="mt-2 text-ink-soft dark:text-ink-soft-dark">{bragLine}</p>
        )}
        {missed.length > 0 && (
          <div className="mt-5 space-y-4 text-left">
            {sortedSummaryGroups.map(([region, items]) => (
              <div key={region}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
                  {region}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
                  {items.map(({ c, missed: wasMissed }) => (
                    <div
                      key={c.cca3}
                      className={`truncate text-sm ${
                        wasMissed ? "text-cat-red dark:text-cat-red-dark" : "text-ink dark:text-ink-dark"
                      }`}
                    >
                      {c.flag} {nameAllListLabel(c, subject)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={playAgain}
          className={`mt-6 w-full rounded-md py-3 font-medium text-white transition-opacity hover:opacity-90 ${accentSolidClass(ACCENT)}`}
        >
          Play again
        </button>
        <button
          onClick={backToSetup}
          className="mt-2 w-full rounded-md py-2 text-sm text-ink-soft transition-colors hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
        >
          Back to settings
        </button>
      </motion.div>
    );
  }

  if (phase === "summary") {
    // Same combined region-grouped treatment as Manifest's summary: mastered
    // items first (alphabetical), then still-to-learn ones in red, grouped
    // by region, instead of a separate flat pill list.
    let sortedSummaryGroups: [string, { cca3: string; flag: string; label: string; missed: boolean }[]][] =
      [];
    if (remainingOnGiveUp && remainingOnGiveUp.length > 0) {
      const remainingCca3s = new Set(remainingOnGiveUp.map((r) => r.cca3));
      const masteredList = pool
        .filter((c) => !remainingCca3s.has(c.cca3))
        .map((c) => ({ cca3: c.cca3, region: c.region, flag: c.flag, label: c.name, missed: false }));
      const missedList = remainingOnGiveUp.map((r) => ({ ...r, missed: true }));
      const groups = new Map<string, { cca3: string; flag: string; label: string; missed: boolean }[]>();
      for (const entry of [...masteredList, ...missedList]) {
        const list = groups.get(entry.region);
        if (list) list.push(entry);
        else groups.set(entry.region, [entry]);
      }
      for (const list of groups.values()) {
        list.sort((a, b) => {
          if (a.missed !== b.missed) return a.missed ? 1 : -1;
          return a.label.localeCompare(b.label);
        });
      }
      sortedSummaryGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }

    // Only worth a line when something actually needed a second look — a
    // clean single pass through the queue makes "Round 1: N/N" redundant
    // with the mastered-count line right above it.
    const rounds = roundBreakdown(sessionTally);
    const showRounds = rounds.length > 1;
    const missedItems = reviewList(sessionTally);

    return (
      <motion.div
        key="summary-shared"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PANEL_TRANSITION}
        className="mx-auto max-w-2xl px-4 text-center"
      >
        <Confetti active={celebrate} />
        {sessionType === "learn" ? (
          remainingOnGiveUp && remainingOnGiveUp.length > 0 ? (
            <>
              <p className="font-serif text-2xl text-ink dark:text-ink-dark">
                {pool.length - remainingOnGiveUp.length} / {pool.length} mastered
              </p>
              <div className="mt-5 space-y-4 text-left">
                {sortedSummaryGroups.map(([region, items]) => (
                  <div key={region}>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
                      {region}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
                      {items.map((item) => (
                        <div
                          key={item.cca3}
                          className={`truncate text-sm ${
                            item.missed
                              ? "text-cat-red dark:text-cat-red-dark"
                              : "text-ink dark:text-ink-dark"
                          }`}
                        >
                          {item.flag} {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="font-serif text-2xl text-ink dark:text-ink-dark">All mastered! 🎉</p>
              <p className="mt-2 text-ink-soft dark:text-ink-soft-dark">{bragLine ?? "You got every item in this selection right."}</p>
            </>
          )
        ) : (
          <>
            <p className="font-serif text-2xl text-ink dark:text-ink-dark">
              {score.correct} / {score.total} correct
            </p>
            <p className="mt-2 text-ink-soft dark:text-ink-soft-dark">
              {score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0}%
              {perfectQuizWin && " — perfect! 🎉"}
            </p>
            {perfectQuizWin && bragLine && (
              <p className="mt-1 text-ink-soft dark:text-ink-soft-dark">{bragLine}</p>
            )}
          </>
        )}
        {showRounds && (
          <p className="mt-2 text-xs text-ink-soft dark:text-ink-soft-dark">
            {rounds.map((r) => `Round ${r.round}: ${r.correct}/${r.total}`).join(" · ")}
          </p>
        )}
        {categoryBreakdown.length > 1 && (
          <p className="mt-1 text-xs text-ink-soft dark:text-ink-soft-dark">
            {categoryBreakdown
              .map((e) => `${CATEGORY_LABELS[format][e.category] ?? e.category}: ${e.correct}/${e.total}`)
              .join(" · ")}
          </p>
        )}
        {sessionTally.length > 0 && <ReviewMap pool={pool} sessionTally={sessionTally} sessionType={sessionType} />}
        <ReviewDrawer items={missedItems} />
        {sessionType === "quiz" && missedItems.length > 0 && (
          <button
            onClick={learnMissed}
            className="mt-3 w-full cursor-pointer rounded-md border-2 border-dashed border-ink/30 py-3 text-sm font-medium text-ink transition-colors hover:border-ink/50 dark:border-ink-dark/30 dark:text-ink-dark dark:hover:border-ink-dark/50"
          >
            Learn what I missed ({missedItems.length})
          </button>
        )}
        <button
          onClick={playAgain}
          className={`mt-6 w-full rounded-md py-3 font-medium text-white transition-opacity hover:opacity-90 ${accentSolidClass(ACCENT)}`}
        >
          Play again
        </button>
        <button
          onClick={backToSetup}
          className="mt-2 w-full rounded-md py-2 text-sm text-ink-soft transition-colors hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
        >
          Back to settings
        </button>
      </motion.div>
    );
  }

  if (phase === "play" && format === "name-all") {
    return (
      <NameAllPlay
        pool={pool}
        subject={subject}
        timeLimitSeconds={timeLimitSeconds}
        onExit={handleNameAllExit}
      />
    );
  }

  if (phase === "play" && format === "map-identify") {
    return (
      <MapIdentifyPlay
        pool={pool}
        askCapital={askCapital}
        sessionType={sessionType}
        letterHints={letterHints}
        onExit={handleMapIdentifyExit}
      />
    );
  }

  if (phase === "play" && format === "prompt-answer") {
    return (
      <PromptAndAnswerPlay
        pool={pool}
        directionSetting={directionSetting}
        sessionType={sessionType}
        onExit={handlePromptAndAnswerExit}
      />
    );
  }

  if (phase === "play" && format === "borders") {
    return (
      <BorderPlay
        pool={pool}
        typeSetting={borderTypeSetting}
        sessionType={sessionType}
        showMap={borderShowMap}
        letterHints={letterHints}
        onExit={handleBorderExit}
      />
    );
  }

  if (phase === "play" && format === "size-compare") {
    return <SizeComparePlay pool={pool} sessionType={sessionType} onExit={handleSizeCompareExit} />;
  }

  if (phase === "passport") {
    return <PassportPage onClose={() => setPhase("setup")} />;
  }

  const startDisabled = pool.length === 0;

  return (
    <motion.div
      key="setup"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={PANEL_TRANSITION}
      className="isolate mx-auto my-8 max-w-xl rounded-[28px] border-[6px] border-double border-ink/20 bg-paper-card px-6 py-12 shadow-2xl dark:border-ink-dark/20 dark:bg-paper-card-dark"
    >
      <svg
        className="pointer-events-none fixed inset-0 -z-10 opacity-35"
        viewBox="0 0 1000 700"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M -20 120 Q 300 20 520 160 T 1020 90"
          fill="none"
          className="stroke-ink dark:stroke-ink-dark"
          strokeWidth={1.5}
          strokeDasharray="1 10"
          strokeLinecap="round"
        />
        <path
          d="M -20 620 Q 260 520 480 600 T 1020 540"
          fill="none"
          className="stroke-cat-yellow dark:stroke-cat-yellow-dark"
          strokeWidth={1.5}
          strokeDasharray="1 10"
          strokeLinecap="round"
        />
      </svg>

      <svg
        className="pointer-events-none fixed right-[3vw] bottom-[3vw] -z-10 h-32 w-32 opacity-30"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          className="stroke-ink dark:stroke-ink-dark"
          strokeWidth={1.2}
        />
        <circle cx="50" cy="50" r="2.5" className="fill-cat-red dark:fill-cat-red-dark" />
        <g className="stroke-ink dark:stroke-ink-dark" strokeWidth={1}>
          <line x1="50" y1="4" x2="50" y2="16" />
          <line x1="50" y1="84" x2="50" y2="96" />
          <line x1="4" y1="50" x2="16" y2="50" />
          <line x1="84" y1="50" x2="96" y2="50" />
        </g>
        <polygon points="50,14 55,50 50,86 45,50" className="fill-cat-red dark:fill-cat-red-dark" opacity={0.85} />
        <text
          x="50"
          y="12"
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize={9}
          className="fill-ink dark:fill-ink-dark"
        >
          N
        </text>
      </svg>

      <header className="relative -mx-6 -mt-12 overflow-hidden rounded-t-[22px] bg-gradient-to-b from-cat-red via-cat-orange to-cat-yellow px-6 pt-14 pb-12 text-center dark:from-cat-red-dark dark:via-cat-orange-dark dark:to-cat-yellow-dark">
        <svg
          className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2"
          width="240"
          height="120"
          viewBox="0 0 240 120"
          aria-hidden="true"
        >
          <circle cx="120" cy="120" r="90" className="fill-paper-card/25 dark:fill-paper-card-dark/20" />
        </svg>

        <button
          onClick={() => setPhase("passport")}
          title="Your passport"
          aria-label="Your passport"
          className="pointer-events-auto absolute left-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-white shadow-sm backdrop-blur hover:bg-white/25"
        >
          🛂
        </button>
        <DarkModeToggle className="absolute right-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-white shadow-sm backdrop-blur hover:bg-white/25" />

        <h1 className="relative font-serif text-4xl font-bold tracking-tight text-white drop-shadow-sm sm:text-5xl md:text-6xl">
          CountryMaxxing
        </h1>
        <p className="font-label relative mt-2 text-xs uppercase tracking-[0.14em] text-white/85">{tagline}</p>
      </header>

      <div className="mt-9">
        <p className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-ink dark:text-ink-dark">
          Choose your route
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {FORMAT_OPTIONS.map((opt) => {
            const selected = format === opt.id;
            const fillTextClass = DARK_TEXT_ON_FILL.has(opt.hue) ? "text-ink" : "text-white";
            return (
              <button
                key={opt.id}
                onClick={() => setFormat(opt.id)}
                className={`relative cursor-pointer rounded-2xl px-3 py-5 text-center shadow-sm transition-all duration-200 ease-out before:pointer-events-none before:absolute before:inset-1.5 before:rounded-xl before:border before:border-dashed before:transition-colors before:duration-200 hover:-translate-y-1 ${
                  selected
                    ? `-rotate-1 shadow-md ${accentSolidClass(opt.hue)} ${fillTextClass} before:border-current/30`
                    : "bg-paper-card before:border-border dark:bg-paper-card-dark dark:before:border-border-dark"
                }`}
              >
                <span
                  className={`block font-serif text-xl font-bold transition-colors duration-200 ${selected ? "" : accentTextClass(opt.hue)}`}
                >
                  {opt.glyph}
                </span>
                <span className="font-label mt-1.5 block text-xs font-bold uppercase tracking-wide">
                  {opt.label}
                </span>
                <span
                  className={`mt-1 block text-[11px] leading-tight transition-colors duration-200 ${
                    selected ? "opacity-85" : "text-ink-soft dark:text-ink-soft-dark"
                  }`}
                >
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {(format === "prompt-answer" ||
          format === "map-identify" ||
          format === "borders" ||
          format === "size-compare") && (
          <motion.div
            key="session-type"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={PANEL_TRANSITION}
            className="mt-8 overflow-hidden"
          >
          <p className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-ink dark:text-ink-dark">
            Session type
          </p>
          <div className="mt-3 flex gap-1 rounded-xl bg-paper-card p-1 ring-1 ring-inset ring-border dark:bg-paper-card-dark dark:ring-border-dark">
            {(
              [
                { id: "learn", label: "Learn", hint: "Loop until you get everything right" },
                { id: "quiz", label: "Quiz", hint: "One pass, scored" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSessionType(opt.id)}
                className={`flex-1 cursor-pointer rounded-lg px-4 py-3 text-left transition-colors duration-200 ${
                  sessionType === opt.id
                    ? "bg-ink text-paper dark:bg-ink-dark dark:text-paper-dark"
                    : "text-ink-soft hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
                }`}
              >
                <span className="font-label block text-xs font-bold uppercase tracking-wide">
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-[11px] font-normal opacity-75">{opt.hint}</span>
              </button>
            ))}
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {format === "prompt-answer" && (
          <motion.div
            key="prompt-answer-options"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={PANEL_TRANSITION}
            className="mt-8 overflow-hidden"
          >
          <p className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-ink dark:text-ink-dark">
            Direction
          </p>
          <div className="mt-3 flex gap-1 rounded-xl bg-paper-card p-1 ring-1 ring-inset ring-border dark:bg-paper-card-dark dark:ring-border-dark">
            {(
              [
                { id: "mixed", label: "Mixed" },
                { id: "country-to-capital", label: "Country → Capital" },
                { id: "capital-to-country", label: "Capital → Country" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setDirectionSetting(opt.id)}
                className={`font-label flex-1 cursor-pointer rounded-lg px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide transition-colors duration-200 ${
                  directionSetting === opt.id
                    ? "bg-ink text-paper dark:bg-ink-dark dark:text-paper-dark"
                    : "text-ink-soft hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {format === "map-identify" && (
          <motion.div
            key="map-identify-options"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={PANEL_TRANSITION}
            className="mt-8 overflow-hidden"
          >
          <DeclareCheckbox checked={askCapital} onChange={setAskCapital}>
            Also ask for the capital
          </DeclareCheckbox>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {format === "borders" && (
          <motion.div
            key="border-options"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={PANEL_TRANSITION}
            className="overflow-hidden"
          >
          <div className="mt-8">
            <p className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-ink dark:text-ink-dark">
              Question type
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-paper-card p-1 ring-1 ring-inset ring-border dark:bg-paper-card-dark dark:ring-border-dark">
              {(
                [
                  { id: "mixed", label: "Mixed", hint: "A bit of everything" },
                  { id: "name-neighbors", label: "Name the neighbors", hint: "List every bordering country" },
                  { id: "reverse-lookup", label: "Who borders these?", hint: "Name the country from its neighbors" },
                  { id: "longest-shortest", label: "Longest / shortest", hint: "Which neighbor's border is extreme" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setBorderTypeSetting(opt.id)}
                  className={`cursor-pointer rounded-lg px-3 py-3 text-left transition-colors duration-200 ${
                    borderTypeSetting === opt.id
                      ? "bg-ink text-paper dark:bg-ink-dark dark:text-paper-dark"
                      : "text-ink-soft hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
                  }`}
                >
                  <span className="font-label block text-xs font-bold uppercase tracking-wide">{opt.label}</span>
                  <span className="mt-0.5 block text-[11px] font-normal opacity-75">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <DeclareCheckbox checked={borderShowMap} onChange={setBorderShowMap}>
              Show the map
            </DeclareCheckbox>
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {format === "name-all" && (
          <motion.div
            key="name-all-options"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={PANEL_TRANSITION}
            className="overflow-hidden"
          >
          <div className="mt-8">
            <p className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-ink dark:text-ink-dark">
              Name the
            </p>
            <div className="mt-3 flex gap-1 rounded-xl bg-paper-card p-1 ring-1 ring-inset ring-border dark:bg-paper-card-dark dark:ring-border-dark">
              {(
                [
                  { id: "countries", label: "Countries" },
                  { id: "capitals", label: "Capitals" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSubject(opt.id)}
                  className={`font-label flex-1 cursor-pointer rounded-lg px-3 py-3 text-center text-xs font-bold uppercase tracking-wide transition-colors duration-200 ${
                    subject === opt.id
                      ? "bg-ink text-paper dark:bg-ink-dark dark:text-paper-dark"
                      : "text-ink-soft hover:text-ink dark:text-ink-soft-dark dark:hover:text-ink-dark"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <DeclareCheckbox checked={speedRoundEnabled} onChange={setSpeedRoundEnabled}>
              Speed round — race the clock
            </DeclareCheckbox>
            {speedRoundEnabled && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {SPEED_ROUND_OPTIONS.map((seconds) => (
                  <button
                    key={seconds}
                    onClick={() => setSpeedRoundSeconds(seconds)}
                    className={`font-label cursor-pointer rounded-full px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors duration-200 ${
                      speedRoundSeconds === seconds
                        ? "bg-ink text-paper dark:bg-ink-dark dark:text-paper-dark"
                        : "bg-paper-card text-ink-soft ring-1 ring-inset ring-border hover:text-ink dark:bg-paper-card-dark dark:text-ink-soft-dark dark:ring-border-dark dark:hover:text-ink-dark"
                    }`}
                  >
                    {seconds / 60}m
                  </button>
                ))}
                <div className="flex items-center gap-1.5 rounded-full bg-paper-card px-3.5 py-2 ring-1 ring-inset ring-border dark:bg-paper-card-dark dark:ring-border-dark">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={Math.round(speedRoundSeconds / 60)}
                    onChange={(e) => {
                      const minutes = Math.max(1, Math.min(60, Number(e.target.value) || 0));
                      setSpeedRoundSeconds(minutes * 60);
                    }}
                    className="w-10 bg-transparent text-center text-xs font-bold text-ink outline-none dark:text-ink-dark"
                  />
                  <span className="font-label text-[10px] uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
                    min (custom)
                  </span>
                </div>
              </div>
            )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <p className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-ink dark:text-ink-dark">
            Regions
          </p>
          <div className="font-label flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
            <button
              onClick={() => setSelectedRegions(new Set(regions))}
              className="cursor-pointer transition-colors duration-200 hover:text-ink dark:hover:text-ink-dark"
            >
              All
            </button>
            <span aria-hidden="true" className="text-border dark:text-border-dark">
              ·
            </span>
            <button
              onClick={() => setSelectedRegions(new Set())}
              className="cursor-pointer transition-colors duration-200 hover:text-ink dark:hover:text-ink-dark"
            >
              None
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {regions.map((region) => {
            const selected = selectedRegions.has(region);
            return (
              <button
                key={region}
                onClick={() => toggleRegion(region)}
                className={`font-label relative cursor-pointer rounded-l-[3px] rounded-r-full py-2 pl-5 pr-4 text-xs font-bold uppercase tracking-wide transition-all duration-200 before:pointer-events-none before:absolute before:left-2 before:top-1/2 before:h-[5px] before:w-[5px] before:-translate-y-1/2 before:rounded-full before:transition-colors before:duration-200 before:content-[''] hover:-translate-y-0.5 ${
                  selected
                    ? "bg-ink text-paper before:bg-cat-yellow dark:bg-ink-dark dark:text-paper-dark dark:before:bg-cat-yellow-dark"
                    : "bg-paper-card text-ink-soft ring-1 ring-inset ring-border before:bg-paper before:ring-1 before:ring-border hover:text-ink dark:bg-paper-card-dark dark:text-ink-soft-dark dark:ring-border-dark dark:before:bg-paper-dark dark:before:ring-border-dark dark:hover:text-ink-dark"
                }`}
              >
                {region}
              </button>
            );
          })}
        </div>
      </div>

      {format !== "name-all" && (
        <div className="mt-8">
          <DeclareCheckbox checked={focusOnWeakSpots} onChange={setFocusOnWeakSpots}>
            Focus on weak spots{" "}
            <span className="text-ink-soft dark:text-ink-soft-dark">
              ({weakPool.length} weak spot{weakPool.length === 1 ? "" : "s"} in this selection)
            </span>
          </DeclareCheckbox>
          <p className="mt-1.5 pl-8 text-xs text-ink-soft dark:text-ink-soft-dark">
            A weak spot needs a few attempts and recent accuracy under 70% — your last few tries count
            for more than old ones, so a rough patch you've since gotten past clears out on its own.
          </p>
        </div>
      )}

      {format !== "name-all" && format !== "prompt-answer" && (
        <div className="mt-8">
          <DeclareCheckbox checked={letterHints} onChange={setLetterHints}>
            Letter hints
          </DeclareCheckbox>
          <p className="mt-1.5 pl-8 text-xs text-ink-soft dark:text-ink-soft-dark">
            Every question shows a hangman-style scaffold (some letters, some blanks) instead of a
            blank field.
          </p>
        </div>
      )}

      {/* Two different Depart controls for two different input types, not
          two different screen sizes — a narrow desktop window still has a
          precise mouse/trackpad, and a wide touchscreen tablet still
          doesn't. coarse-pointer: (see index.css) reflects the actual
          primary pointing device via the `pointer` media feature. */}
      <div className="coarse-pointer:hidden">
        <div
          className={`mt-10 flex overflow-hidden rounded-2xl shadow-lg transition-all duration-300 ${startDisabled ? "opacity-40" : "hover:-translate-y-0.5 hover:shadow-xl"}`}
        >
          <button
            onClick={startSession}
            disabled={startDisabled}
            className={`flex-1 cursor-pointer px-7 py-6 text-left transition-opacity hover:opacity-90 disabled:cursor-not-allowed ${accentSolidClass(ACCENT)} text-white`}
          >
            <span className="font-label block text-base font-bold uppercase tracking-wide">
              {startDisabled ? "No countries selected" : "Depart"}
            </span>
            {!startDisabled && (
              <span className="mt-0.5 block text-xs font-normal opacity-85">
                {pool.length} countries selected
                {format !== "name-all" && ` · ${sessionType === "learn" ? "Learn" : "Quiz"} mode`}
              </span>
            )}
          </button>
          <div
            className={`flex w-16 items-center justify-center border-l-2 border-dashed border-white/40 text-xl text-white brightness-90 ${accentSolidClass(ACCENT)}`}
          >
            ✈
          </div>
        </div>
      </div>

      <div className="hidden coarse-pointer:block">
        <SlideToDepart
          label={startDisabled ? "No countries selected" : "Depart"}
          sublabel={
            startDisabled
              ? undefined
              : `${pool.length} countries selected${format !== "name-all" ? ` · ${sessionType === "learn" ? "Learn" : "Quiz"} mode` : ""}`
          }
          disabled={startDisabled}
          accent={ACCENT}
          onComplete={startSession}
        />
      </div>
    </motion.div>
  );
}
