import { useEffect, useRef, useState, type FormEvent } from "react";
import { countries, type Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { SoundToggle } from "../../components/SoundToggle";
import { DarkModeToggle } from "../../components/DarkModeToggle";
import { isCloseMatch } from "../../core/fuzzyMatch";
import { accentSolidClass } from "../../core/palette";
import { comboClass, comboEmoji, comboTier } from "../../core/combo";
import { playCorrect, playIncorrect } from "../../core/sound";
import { useKeyboardInset } from "../../core/useKeyboardInset";
import { useShake } from "../../core/useShake";
import { letterHint } from "../../core/letterHint";
import {
  reviewList,
  useCategoryTally,
  useSessionTally,
  type CategoryBreakdownEntry,
  type TalliedItem,
} from "../../core/sessionTally";
import { ReviewItemsList } from "./ReviewDrawer";
import { MAP_ALWAYS_INSET, MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import {
  borderExpectedAnswer,
  borderMatchCandidates,
  borderPromptFor,
  borderQuestionKey,
  buildBorderQueue,
  recordBorderAttempt,
  requeueAfterMiss,
  type BorderQuestion,
  type BorderQuestionTypeSetting,
  type SessionType,
} from "./engine";

const ACCENT = "red"; // matches CountryMaxxing.tsx's accent

export interface BorderResult {
  correct: number;
  total: number;
  /** Still-unmastered questions — present only on an early give-up in Learn
   * mode. cca3/region ride along so the summary screen can group these by
   * region the same way the other modes' summaries do. */
  remaining?: { cca3: string; region: string; label: string; flag: string }[];
  /** Every attempt this session, per country — feeds the summary screen's
   * round breakdown, review drawer, and difficulty-tinted map. */
  sessionTally: TalliedItem[];
  /** Accuracy split by question type — only interesting when typeSetting is
   * "mixed"; a fixed single type just reproduces the overall score. */
  typeBreakdown: CategoryBreakdownEntry[];
}

export function BorderPlay({
  pool,
  typeSetting,
  sessionType,
  showMap,
  letterHints,
  onExit,
}: {
  pool: Country[];
  typeSetting: BorderQuestionTypeSetting;
  sessionType: SessionType;
  showMap: boolean;
  letterHints: boolean;
  onExit: (result: BorderResult | null) => void;
}) {
  const [queue, setQueue] = useState<BorderQuestion[]>(() => buildBorderQueue(pool, typeSetting));
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  // See PromptAndAnswerPlay.tsx's matching comment — mid-session review of
  // what's gone wrong so far, mutually exclusive with the Skipped panel.
  const [showReview, setShowReview] = useState(false);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "correct" | "incorrect">("idle");
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [combo, setCombo] = useState(0);
  // See PromptAndAnswerPlay.tsx's matching comment — distinguishes "you
  // tried and missed" copy/shake from "you asked to be shown" for the
  // reverse-lookup/longest-shortest give-up path (giveUpOnQuestion). Not
  // needed for name-neighbors — its own feedback text (giveUpOnCurrent) is
  // already give-up-only phrasing ("Missed X, Y" / "Got them all"), never
  // shown for a genuine wrong guess.
  const [gaveUp, setGaveUp] = useState(false);
  // reverse-lookup/longest-shortest only — same forced-retype-to-advance
  // gate as the other two modes (see PromptAndAnswerPlay.tsx). Name-neighbors
  // doesn't need its own flag: it reuses foundNeighborCca3s itself as the
  // "has everything been retyped back" signal (see canAdvance below).
  const [retyped, setRetyped] = useState(false);
  const { shaking, trigger: triggerShake } = useShake();
  const sessionTally = useSessionTally();
  const typeTally = useCategoryTally();
  // Countries whose question has been fully answered correctly / answered
  // wrong (or given up on) — same "current vs wrong vs done" map convention
  // as the other modes, keyed to the question's *subject* country.
  const [completedCcn3s, setCompletedCcn3s] = useState<Set<string>>(new Set());
  const [wrongCcn3s, setWrongCcn3s] = useState<Set<string>>(new Set());
  // "name-neighbors" only — which of the current question's neighbors have
  // been typed in so far. Reset whenever the current question changes.
  const [foundNeighborCca3s, setFoundNeighborCca3s] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<{ kind: "already" | "unknown" | "wrong"; text: string } | null>(null);

  // See PromptAndAnswerPlay.tsx's matching comment — same iOS Safari
  // keyboard-covers-input fix, plus shrinking the map to give the answer
  // panel more room (Frontiers' questions are textual, not map-identify).
  const keyboardInset = useKeyboardInset();
  const isTyping = keyboardInset > 0;
  const bottomBarStyle = isTyping ? { bottom: keyboardInset + 16 } : undefined;

  const inputRef = useRef<HTMLInputElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const advanceRef = useRef<() => void>(() => {});

  const poolCcn3s = useRef(new Set(pool.map((c) => c.ccn3))).current;
  const pointCountries = useRef(
    new Map(
      pool
        .filter((c) => MAP_HARD_TO_RENDER.has(c.cca3) && !MAP_ALWAYS_INSET.has(c.cca3))
        .map((c) => [c.ccn3, c.capitalLatLng] as const),
    ),
  ).current;
  const alwaysInsetCcn3s = useRef(
    new Set(pool.filter((c) => MAP_ALWAYS_INSET.has(c.cca3)).map((c) => c.ccn3)),
  ).current;

  const current = queue[0] ?? null;
  const currentKey = current ? borderQuestionKey(current) : null;
  const isNameNeighbors = current?.type === "name-neighbors";
  advanceRef.current = advance;

  // A miss only clears once it's been typed back correctly — same retention
  // mechanic as the other two modes (see PromptAndAnswerPlay.tsx). For
  // name-neighbors there's no separate "retype" flag: giving up leaves
  // foundNeighborCca3s short of the full set, and submitNeighbor keeps
  // accepting input (without re-triggering the "correct" branch — see
  // below) until every missed neighbor has been typed back in.
  const neighborsComplete = current ? foundNeighborCca3s.size === current.neighbors.length : false;
  const canAdvance = isNameNeighbors
    ? feedback === "correct" || (feedback === "incorrect" && neighborsComplete)
    : feedback === "correct" || (feedback === "incorrect" && retyped);

  useEffect(() => {
    setFoundNeighborCca3s(new Set());
  }, [currentKey]);

  useEffect(() => {
    if (feedback === "idle" || (feedback === "incorrect" && !canAdvance)) inputRef.current?.focus();
    else nextButtonRef.current?.focus();
  }, [feedback, currentKey, canAdvance]);

  // A correct answer (or a fully retyped miss) auto-advances after a beat;
  // an unretyped miss waits indefinitely. Same reasoning as the other
  // modes: see the "Play-screen answer panel pattern" note in CLAUDE.md.
  useEffect(() => {
    if (!canAdvance) return;
    const timeout = setTimeout(() => advanceRef.current(), 800);
    return () => clearTimeout(timeout);
  }, [canAdvance, currentKey]);

  useEffect(() => {
    if (feedback !== "incorrect") return;
    const timeout = setTimeout(() => setInput(""), 350);
    return () => clearTimeout(timeout);
  }, [feedback, currentKey]);

  function submitAnswer(answer: string, isGiveUp = false) {
    if (!current) return;
    const correct = isCloseMatch(answer, borderMatchCandidates(current));
    recordBorderAttempt(current, correct);
    sessionTally.record(
      { cca3: current.country.cca3, label: current.country.name, flag: current.country.flag },
      correct,
      isGiveUp,
    );
    typeTally.record(current.type, correct);
    if (correct) {
      playCorrect();
      setCombo((c) => c + 1);
    } else {
      playIncorrect();
      setCombo(0);
      if (!isGiveUp) triggerShake();
    }
    setGaveUp(isGiveUp);
    setRetyped(false);
    setFeedback(correct ? "correct" : "incorrect");
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
  }

  // "name-neighbors" has no single right/wrong moment — each correctly
  // typed neighbor just gets crossed off. Once every neighbor is found it
  // behaves like a correct answer (auto-advance); "Give up" behaves like an
  // incorrect one (reveal + manual Next), same finish() vs. giveUp() split
  // as Name All's per-round handling.
  function submitNeighbor(answer: string) {
    if (!current) return;
    const trimmed = answer.trim();
    if (!trimmed) return;
    const already = current.neighbors.find(
      (n) => foundNeighborCca3s.has(n.cca3) && isCloseMatch(trimmed, [n.name, ...n.altNames]),
    );
    if (already) {
      setHint({ kind: "already", text: `Already got ${already.name}.` });
      setInput("");
      return;
    }
    const match = current.neighbors.find(
      (n) => !foundNeighborCca3s.has(n.cca3) && isCloseMatch(trimmed, [n.name, ...n.altNames]),
    );
    if (!match) {
      playIncorrect();
      // A real, correctly-spelled country that just isn't one of this
      // subject's neighbors gets a definitive "wrong" message rather than
      // the typo-shaped "try another spelling?" one — same distinction as
      // Manifest's out-of-pool hint.
      const realCountry = countries.find(
        (c) => c.cca3 !== current.country.cca3 && isCloseMatch(trimmed, [c.name, ...c.altNames]),
      );
      setHint(
        realCountry
          ? { kind: "wrong", text: `${realCountry.name} doesn't border ${current.country.name}.` }
          : { kind: "unknown", text: "Not finding that one — try another spelling?" },
      );
      return;
    }
    playCorrect();
    setHint(null);
    setInput("");
    const nextFound = new Set(foundNeighborCca3s).add(match.cca3);
    setFoundNeighborCca3s(nextFound);
    // Only a genuine live completion (not a post-give-up retype catching the
    // set up) counts as a correct attempt/score bump — retyping back the
    // ones you already missed shouldn't retroactively turn the miss into a
    // win, just unlock the advance.
    if (feedback === "idle" && nextFound.size === current.neighbors.length) {
      recordBorderAttempt(current, true);
      sessionTally.record(
        { cca3: current.country.cca3, label: current.country.name, flag: current.country.flag },
        true,
      );
      typeTally.record(current.type, true);
      setCombo((c) => c + 1);
      setScore((s) => ({ correct: s.correct + 1, total: s.total + 1 }));
      setFeedback("correct");
    }
  }

  function advance() {
    if (!current) return;
    const key = borderQuestionKey(current);
    const wasIncorrect = feedback === "incorrect";
    const requeue = sessionType === "learn" && wasIncorrect;
    const rest = queue.slice(1);
    const nextQueue = requeue ? requeueAfterMiss(rest, current) : rest;
    const ccn3 = current.country.ccn3;

    setSkippedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (wasIncorrect) {
      setWrongCcn3s((prev) => new Set(prev).add(ccn3));
    } else {
      setCompletedCcn3s((prev) => new Set(prev).add(ccn3));
      setWrongCcn3s((prev) => {
        if (!prev.has(ccn3)) return prev;
        const next = new Set(prev);
        next.delete(ccn3);
        return next;
      });
    }
    setQueue(nextQueue);
    setInput("");
    setFeedback("idle");
    setHint(null);
    setGaveUp(false);
    setRetyped(false);
    if (nextQueue.length === 0)
      onExit({ ...score, sessionTally: sessionTally.getItems(), typeBreakdown: typeTally.getBreakdown() });
  }

  // For "name-neighbors" specifically: give up on this country (not the
  // whole session) — reveals whatever's left, records the miss, and moves
  // on to the next question, same shape as advance() after a wrong answer.
  function giveUpOnCurrent() {
    if (!current || !isNameNeighbors) return;
    if (foundNeighborCca3s.size < current.neighbors.length) {
      recordBorderAttempt(current, false);
      sessionTally.record(
        { cca3: current.country.cca3, label: current.country.name, flag: current.country.flag },
        false,
        true,
      );
      typeTally.record(current.type, false);
    }
    setFeedback("incorrect");
  }

  function skip() {
    if (!current || feedback !== "idle") return;
    const key = borderQuestionKey(current);
    const rest = queue.slice(1);
    setSkippedKeys((prev) => new Set(prev).add(key));
    setQueue([...rest, current]);
    setInput("");
    setFeedback("idle");
    setHint(null);
  }

  // Same idea as name-neighbors' giveUpOnCurrent, for the other two question
  // types: reveals the answer and counts it as a miss via the normal wrong-
  // answer path, then continues the round rather than ending it.
  function giveUpOnQuestion() {
    if (!current || isNameNeighbors || feedback !== "idle") return;
    submitAnswer("", true);
  }

  function jumpTo(target: BorderQuestion) {
    const key = borderQuestionKey(target);
    setQueue((q) => [target, ...q.filter((item) => borderQuestionKey(item) !== key)]);
    setInput("");
    setFeedback("idle");
    setShowSkipped(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isNameNeighbors) {
      if (feedback === "idle" || (feedback === "incorrect" && !neighborsComplete)) {
        submitNeighbor(input);
        return;
      }
      advance();
      return;
    }
    if (feedback === "idle") {
      if (!input.trim()) return;
      submitAnswer(input);
      return;
    }
    if (feedback === "incorrect" && !retyped) {
      if (!input.trim()) return;
      if (isCloseMatch(input, borderMatchCandidates(current))) {
        setRetyped(true);
      } else {
        triggerShake();
      }
      return;
    }
    advance();
  }

  if (!current) return null;

  const skippedPending = queue.filter((q) => skippedKeys.has(borderQuestionKey(q)));
  const reviewItems = reviewList(sessionTally.getItems());

  // "reverse-lookup" has the subject as the secret answer — spoiling it on
  // the map before answering would hand over the question outright. The
  // other two types already name the subject in the prompt text, so
  // revealing it on the map isn't a spoiler.
  const safeToReveal = feedback !== "idle" || current.type !== "reverse-lookup";
  const currentCcn3 = showMap && safeToReveal ? current.country.ccn3 : undefined;

  // Neighbors already named for the current "name-neighbors" question, filled
  // in live as they're found — cleared automatically on the next question via
  // the foundNeighborCca3s reset effect above.
  const foundNeighborCcn3s = isNameNeighbors
    ? current.neighbors.filter((n) => foundNeighborCca3s.has(n.cca3)).map((n) => n.ccn3)
    : [];
  const mapFilledCcn3s =
    foundNeighborCcn3s.length > 0 ? new Set([...completedCcn3s, ...foundNeighborCcn3s]) : completedCcn3s;

  return (
    <div className="relative h-dvh animate-[swoop-in_0.5s_ease-out] bg-paper dark:bg-paper-dark">
      {showMap && (
        <WorldMap
          filledCcn3s={mapFilledCcn3s}
          currentCcn3={currentCcn3}
          wrongCcn3s={wrongCcn3s}
          focusCcn3s={poolCcn3s}
          pointCountries={pointCountries}
          autoZoomCcn3={currentCcn3}
          alwaysInsetCcn3s={alwaysInsetCcn3s}
          className={`w-full portrait:w-auto transition-[height] duration-300 ${isTyping ? "h-[35dvh]" : "h-full"}`}
        />
      )}

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
          {skippedPending.length > 0 && (
            <button
              onClick={() => {
                setShowSkipped((s) => !s);
                setShowReview(false);
              }}
              className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink-soft shadow-sm backdrop-blur hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
            >
              Skipped ({skippedPending.length})
            </button>
          )}
          {reviewItems.length > 0 && (
            <button
              onClick={() => {
                setShowReview((s) => !s);
                setShowSkipped(false);
              }}
              className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink-soft shadow-sm backdrop-blur hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
            >
              Review ({reviewItems.length})
            </button>
          )}
          {combo >= 2 && (
            <span
              key={comboTier(combo)}
              className={`pop-in pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 shadow-sm backdrop-blur dark:bg-paper-card-dark/95 ${comboClass(combo)}`}
            >
              {comboEmoji(combo)} ×{combo}
            </span>
          )}
          <span className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink shadow-sm backdrop-blur dark:bg-paper-card-dark/95 dark:text-ink-dark">
            {sessionType === "quiz" ? `${score.correct} / ${score.total} correct` : `${queue.length} left`}
          </span>
        </div>
      </div>

      {showSkipped ? (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4" style={bottomBarStyle}>
          <div className="w-full max-w-md rounded-md border border-border bg-paper-card/95 p-4 shadow-lg backdrop-blur dark:border-border-dark dark:bg-paper-card-dark/95">
            <p className="mb-3 text-sm font-medium text-ink dark:text-ink-dark">Skipped questions</p>
            <ul className="space-y-2">
              {skippedPending.map((q) => (
                <li key={borderQuestionKey(q)} className="flex items-center justify-between text-sm">
                  <span className="truncate text-ink-soft dark:text-ink-soft-dark">{borderPromptFor(q)}</span>
                  <button
                    onClick={() => jumpTo(q)}
                    className={`ml-3 shrink-0 rounded px-2 py-1 text-xs text-white ${accentSolidClass(ACCENT)}`}
                  >
                    Try now
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : showReview ? (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4" style={bottomBarStyle}>
          <div className="w-full max-w-md rounded-md border border-border bg-paper-card/95 p-4 shadow-lg backdrop-blur dark:border-border-dark dark:bg-paper-card-dark/95">
            <p className="mb-3 text-sm font-medium text-ink dark:text-ink-dark">Review so far</p>
            <ReviewItemsList items={reviewItems} />
          </div>
        </div>
      ) : (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 ${!showMap ? "top-16" : ""}`}
          style={bottomBarStyle}
        >
          <form onSubmit={handleSubmit} className="pointer-events-auto w-full max-w-md space-y-2">
            <div className="flex overflow-hidden rounded-md bg-paper-card/95 shadow-sm backdrop-blur dark:bg-paper-card-dark/95">
              <div className="flex w-14 shrink-0 items-center justify-center border-r-2 border-dashed border-border py-3 text-2xl dark:border-border-dark">
                {safeToReveal ? current.country.flag : "🌐"}
              </div>
              <div className="flex flex-1 items-center justify-center px-4 py-3 text-center">
                {feedback === "incorrect" ? (
                  <div className="space-y-1">
                    {isNameNeighbors ? (
                      <p className="font-serif text-lg text-cat-red dark:text-cat-red-dark">
                        {current.neighbors.length - foundNeighborCca3s.size === 0
                          ? "Got them all — nice."
                          : `Missed ${current.neighbors
                              .filter((n) => !foundNeighborCca3s.has(n.cca3))
                              .map((n) => n.name)
                              .join(", ")}.`}
                      </p>
                    ) : (
                      <p className="font-serif text-xl text-cat-red dark:text-cat-red-dark">
                        {gaveUp
                          ? `It's ${borderExpectedAnswer(current)}.`
                          : `Not quite — it's ${borderExpectedAnswer(current)}.`}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="font-serif text-lg text-ink dark:text-ink-dark">{borderPromptFor(current)}</p>
                    {/* name-neighbors has no single blank to scaffold — it's a
                        multi-answer list, not one expected string. */}
                    {!isNameNeighbors && letterHints && feedback === "idle" && (
                      <p className="mt-1 font-mono text-sm tracking-wide text-ink-soft dark:text-ink-soft-dark">
                        {letterHint(borderExpectedAnswer(current))}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {isNameNeighbors && feedback !== "correct" && (
              <p className="text-center text-xs uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
                {foundNeighborCca3s.size} / {current.neighbors.length} found
              </p>
            )}

            {hint && isNameNeighbors && feedback !== "correct" && (
              <p
                className={`rounded-full bg-paper-card/90 px-3 py-1 text-center text-sm shadow-sm backdrop-blur dark:bg-paper-card-dark/90 ${
                  hint.kind === "already"
                    ? "text-ink-soft dark:text-ink-soft-dark"
                    : "text-cat-red dark:text-cat-red-dark"
                }`}
              >
                {hint.text}
              </p>
            )}

            <div className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={isNameNeighbors ? giveUpOnCurrent : giveUpOnQuestion}
                disabled={feedback !== "idle"}
                title="Give up on this one"
                aria-label="Give up on this one"
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper-card/95 text-cat-red shadow-sm backdrop-blur transition-opacity duration-300 hover:scale-105 dark:bg-paper-card-dark/95 dark:text-cat-red-dark ${
                  feedback === "idle" ? "opacity-100" : "pointer-events-none opacity-40"
                }`}
              >
                🏳️
              </button>

              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  readOnly={canAdvance}
                  placeholder={
                    isNameNeighbors
                      ? "Type a country"
                      : feedback === "incorrect" && !retyped
                        ? "Type it back to lock it in"
                        : "Type your answer"
                  }
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={`w-full rounded-full border bg-paper-card/95 py-3 pl-5 pr-14 text-center text-lg text-ink shadow-lg outline-none backdrop-blur focus:ring-2 focus:ring-cat-blue dark:bg-paper-card-dark/95 dark:text-ink-dark dark:focus:ring-cat-red-dark ${
                    feedback === "correct" ? "border-cat-green dark:border-cat-green-dark" : "border-border dark:border-border-dark"
                  } ${
                    isNameNeighbors
                      ? hint?.kind === "wrong" || hint?.kind === "unknown"
                        ? "shake-subtle"
                        : ""
                      : shaking
                        ? "shake-subtle"
                        : ""
                  }`}
                />
                {!canAdvance && (
                  <button
                    type="submit"
                    aria-label="Submit answer"
                    className={`absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105 ${accentSolidClass(ACCENT)}`}
                  >
                    ✈
                  </button>
                )}
                {canAdvance && (
                  <span
                    aria-hidden="true"
                    className="pop-in absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-cat-green text-white shadow-md dark:bg-cat-green-dark"
                  >
                    ✓
                  </span>
                )}
              </div>

              <button
                ref={nextButtonRef}
                type="button"
                onClick={() => {
                  if (feedback === "idle") skip();
                }}
                disabled={feedback !== "idle"}
                title={feedback === "idle" ? "Skip" : "Next question"}
                aria-label={feedback === "idle" ? "Skip" : "Next question"}
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full shadow-sm transition-all duration-300 hover:scale-105 ${
                  feedback === "idle"
                    ? "bg-paper-card/95 text-ink-soft backdrop-blur hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
                    : `text-white shadow-md ${accentSolidClass(ACCENT)}`
                } ${feedback === "idle" ? "" : canAdvance ? "pointer-events-none spin-slow opacity-40" : "pointer-events-none opacity-40"}`}
              >
                {feedback === "idle" ? "⏭" : "→"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
