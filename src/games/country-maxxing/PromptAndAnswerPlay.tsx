import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { SoundToggle } from "../../components/SoundToggle";
import { DarkModeToggle } from "../../components/DarkModeToggle";
import { isCloseMatch } from "../../core/fuzzyMatch";
import { accentSolidClass } from "../../core/palette";
import { comboClass, comboEmoji, comboTier } from "../../core/combo";
import { playCorrect, playIncorrect } from "../../core/sound";
import { useKeyboardInset } from "../../core/useKeyboardInset";
import { useShake } from "../../core/useShake";
import { recordAttempt } from "../../core/stats";
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
  buildQueue,
  expectedAnswer,
  matchCandidates,
  NAMESPACE,
  promptFor,
  questionKey,
  requeueAfterMiss,
  type DirectionSetting,
  type Question,
  type SessionType,
} from "./engine";

const ACCENT = "red"; // matches CountryMaxxing.tsx's accent

export interface PromptAndAnswerResult {
  correct: number;
  total: number;
  /** Expected answers still not mastered — present only on an early give-up
   * in Learn mode, where "all mastered" wouldn't be true. cca3/region ride
   * along so the summary screen can group these by region the same way
   * Manifest's summary does. */
  remaining?: { cca3: string; region: string; label: string; flag: string }[];
  /** Every attempt this session, per country — feeds the summary screen's
   * round breakdown, review drawer, and difficulty-tinted map. */
  sessionTally: TalliedItem[];
  /** Accuracy split by direction (country → capital vs. capital → country). */
  directionBreakdown: CategoryBreakdownEntry[];
}

export function PromptAndAnswerPlay({
  pool,
  directionSetting,
  sessionType,
  letterHints,
  onExit,
}: {
  pool: Country[];
  directionSetting: DirectionSetting;
  sessionType: SessionType;
  letterHints: boolean;
  onExit: (result: PromptAndAnswerResult | null) => void;
}) {
  const [queue, setQueue] = useState<Question[]>(() => buildQueue(pool, directionSetting));
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  // Lets a Learn-mode session check what's been going wrong so far without
  // waiting for the end-of-session summary — same bottom-panel slot and
  // top-bar toggle pattern as "Skipped," and mutually exclusive with it
  // (see the two onClick handlers below).
  const [showReview, setShowReview] = useState(false);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "correct" | "incorrect">("idle");
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [combo, setCombo] = useState(0);
  // Give Up reuses the wrong-answer path (submitAnswer("")) so it counts as
  // a miss and requeues the same way — this just distinguishes "you tried
  // and missed" copy/shake from "you asked to be shown," which read oddly
  // reusing the same "Not quite" wrong-answer framing.
  const [gaveUp, setGaveUp] = useState(false);
  // Reading the correct answer alone barely builds retrieval — the classic
  // gap between recognizing an answer and being able to produce it. Once
  // wrong, advancing is gated on typing the correct answer back once
  // (isCloseMatch, not a new scored attempt) before Next/auto-advance
  // unlocks. See handleSubmit and the readOnly/button logic below.
  const [retyped, setRetyped] = useState(false);
  const { shaking, trigger: triggerShake } = useShake();
  const sessionTally = useSessionTally();
  const directionTally = useCategoryTally();
  // Countries already answered correctly — kept highlighted (with a capital
  // dot) after moving on, instead of only ever showing the current one, so
  // the map reads as a running progress trail.
  const [completedCcn3s, setCompletedCcn3s] = useState<Set<string>>(new Set());
  // Answered incorrectly and not yet redeemed by a later correct answer —
  // its own color, separate from "done." Getting it right on a requeued
  // attempt (Learn mode) moves it into completedCcn3s and out of here.
  const [wrongCcn3s, setWrongCcn3s] = useState<Set<string>>(new Set());

  // On iOS Safari, 100dvh doesn't shrink for the on-screen keyboard, so a
  // bottom-anchored input can end up hidden behind it — this tracks the real
  // covered height so the input can reposition above it, and doubles as the
  // signal to shrink the map and give the answer panel more room while
  // typing (the map isn't the question here, unlike Terra Incognita).
  const keyboardInset = useKeyboardInset();
  const isTyping = keyboardInset > 0;
  const bottomBarStyle = isTyping ? { bottom: keyboardInset + 16 } : undefined;

  const inputRef = useRef<HTMLInputElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  // Always points at the latest advance() closure so the auto-advance timer
  // below never fires a stale one (e.g. after jumping to a skipped question).
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
  const countryByCcn3 = useRef(new Map(pool.map((c) => [c.ccn3, c] as const))).current;

  const current = queue[0] ?? null;
  const currentKey = current ? questionKey(current) : null;
  // `advance` is a hoisted function declaration below — assigning it here
  // every render keeps the ref current before any effect can read it.
  advanceRef.current = advance;

  useEffect(() => {
    if (feedback === "idle" || (feedback === "incorrect" && !retyped)) inputRef.current?.focus();
    else nextButtonRef.current?.focus();
  }, [feedback, retyped, currentKey]);

  // A correct answer (or a successfully retyped one) auto-advances after a
  // beat; still-unretyped incorrect waits on the user. The effect's own
  // cleanup (on feedback/retyped/currentKey change) cancels it — no manual
  // clearing needed in advance()/skip()/jumpTo().
  useEffect(() => {
    if (feedback !== "correct" && !(feedback === "incorrect" && retyped)) return;
    const timeout = setTimeout(() => advanceRef.current(), 800);
    return () => clearTimeout(timeout);
  }, [feedback, retyped, currentKey]);

  // The wrong guess shakes itself out rather than sitting there readOnly —
  // cleared once the shake animation (0.35s) finishes, so the box reads as
  // reset and ready for the forced retype (see handleSubmit) rather than
  // still showing the wrong guess.
  useEffect(() => {
    if (feedback !== "incorrect") return;
    const timeout = setTimeout(() => setInput(""), 350);
    return () => clearTimeout(timeout);
  }, [feedback, currentKey]);

  function submitAnswer(answer: string, isGiveUp = false) {
    if (!current) return;
    const correct = isCloseMatch(answer, matchCandidates(current));
    recordAttempt(NAMESPACE, questionKey(current), correct);
    sessionTally.record(
      { cca3: current.country.cca3, label: current.country.name, flag: current.country.flag },
      correct,
      isGiveUp,
    );
    directionTally.record(current.direction, correct);
    if (correct) {
      playCorrect();
      setCombo((c) => c + 1);
    } else {
      playIncorrect();
      setCombo(0);
      // Give Up already knows it's "wrong" — the shake is for the surprise
      // of an actual bad guess, not for a deliberate reveal.
      if (!isGiveUp) triggerShake();
    }
    setGaveUp(isGiveUp);
    setRetyped(false);
    setFeedback(correct ? "correct" : "incorrect");
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
  }

  function advance() {
    if (!current) return;
    const key = questionKey(current);
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
    setGaveUp(false);
    setRetyped(false);
    if (nextQueue.length === 0)
      onExit({ ...score, sessionTally: sessionTally.getItems(), directionBreakdown: directionTally.getBreakdown() });
  }

  function skip() {
    if (!current || feedback !== "idle") return;
    const key = questionKey(current);
    const rest = queue.slice(1);
    setSkippedKeys((prev) => new Set(prev).add(key));
    setQueue([...rest, current]);
    setInput("");
    setFeedback("idle");
  }

  // Reveals this question's answer and counts it as a miss, then continues
  // the round via the same path a real wrong guess takes — Skip is for "I
  // think I can get this later," Give Up is for "just show me."
  function giveUp() {
    if (!current || feedback !== "idle") return;
    submitAnswer("", true);
  }

  function jumpTo(target: Question) {
    const key = questionKey(target);
    setQueue((q) => [target, ...q.filter((item) => questionKey(item) !== key)]);
    setInput("");
    setFeedback("idle");
    setShowSkipped(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (feedback === "idle") {
      if (!input.trim()) return;
      submitAnswer(input);
      return;
    }
    if (feedback === "incorrect" && !retyped) {
      // Reading the correct answer isn't enough to lock it in — require
      // producing it once (not scored, not a new attempt) before moving on.
      if (!input.trim()) return;
      if (isCloseMatch(input, matchCandidates(current))) {
        setRetyped(true);
      } else {
        triggerShake();
      }
      return;
    }
    advance();
  }

  if (!current) return null;

  const skippedPending = queue.filter((q) => skippedKeys.has(questionKey(q)));
  const reviewItems = reviewList(sessionTally.getItems());
  const awaitingRetype = feedback === "incorrect" && !retyped;
  const canAdvance = feedback === "correct" || (feedback === "incorrect" && retyped);

  // Highlighting the country on the map before it's answered would hand over
  // the answer outright when the question is "capital → country" (the
  // highlighted shape *is* the answer). It's safe for "country → capital"
  // (the text prompt already names the country), and always safe once
  // answered, as a confirming reveal.
  const safeToReveal = feedback !== "idle" || current.direction === "country-to-capital";
  const currentCcn3 = safeToReveal ? current.country.ccn3 : undefined;
  const dotCcn3s = new Set([...completedCcn3s, ...wrongCcn3s, ...(currentCcn3 ? [currentCcn3] : [])]);
  const capitalDots = new Map(
    Array.from(dotCcn3s, (ccn3) => countryByCcn3.get(ccn3)).flatMap((c) =>
      c ? [[c.ccn3, c.capitalLatLng] as const] : [],
    ),
  );

  return (
    // Full viewport height — there's no App-level header eating space above
    // this in the current single-game shelf. If a second game reintroduces
    // the shelf's "back" header (see App.tsx), this needs to subtract that
    // header's height again, same as it used to.
    <div className="relative h-dvh animate-[swoop-in_0.5s_ease-out] bg-paper dark:bg-paper-dark">
      <WorldMap
        filledCcn3s={completedCcn3s}
        currentCcn3={currentCcn3}
        wrongCcn3s={wrongCcn3s}
        focusCcn3s={poolCcn3s}
        capitalDots={capitalDots}
        pointCountries={pointCountries}
        autoZoomCcn3={currentCcn3}
        alwaysInsetCcn3s={alwaysInsetCcn3s}
        className={`w-full portrait:w-auto transition-[height] duration-300 ${isTyping ? "h-[35dvh]" : "h-full"}`}
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
                <li key={questionKey(q)} className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft dark:text-ink-soft-dark">{promptFor(q)}</span>
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
          className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
          style={bottomBarStyle}
        >
          <form onSubmit={handleSubmit} className="pointer-events-auto w-full max-w-md space-y-2">
            <div className="flex overflow-hidden rounded-md bg-paper-card/95 shadow-sm backdrop-blur dark:bg-paper-card-dark/95">
              <div className="flex w-14 shrink-0 items-center justify-center border-r-2 border-dashed border-border py-3 text-2xl dark:border-border-dark">
                {safeToReveal ? current.country.flag : "✈"}
              </div>
              <div className="flex flex-1 items-center justify-center px-4 py-3 text-center">
                {feedback === "incorrect" ? (
                  <p className="font-serif text-xl text-cat-red dark:text-cat-red-dark">
                    {gaveUp ? `It's ${expectedAnswer(current)}.` : `Not quite — it's ${expectedAnswer(current)}.`}
                  </p>
                ) : (
                  <div>
                    <p className="font-serif text-xl text-ink dark:text-ink-dark">{promptFor(current)}</p>
                    {letterHints && feedback === "idle" && (
                      <p className="mt-1 font-mono text-sm tracking-wide text-ink-soft dark:text-ink-soft-dark">
                        {letterHint(expectedAnswer(current))}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={giveUp}
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
                  readOnly={feedback === "correct" || (feedback === "incorrect" && retyped)}
                  placeholder={awaitingRetype ? "Type it back to lock it in" : "Type your answer"}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={`w-full rounded-full border bg-paper-card/95 py-3 pl-5 pr-14 text-center text-lg text-ink shadow-lg outline-none backdrop-blur focus:ring-2 focus:ring-cat-blue dark:bg-paper-card-dark/95 dark:text-ink-dark dark:focus:ring-cat-red-dark ${
                    feedback === "correct" ? "border-cat-green dark:border-cat-green-dark" : "border-border dark:border-border-dark"
                  } ${shaking ? "shake-subtle" : ""}`}
                />
                {(feedback === "idle" || awaitingRetype) && (
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
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper-card/95 text-ink-soft shadow-sm backdrop-blur transition-all duration-300 hover:scale-105 dark:bg-paper-card-dark/95 dark:text-ink-soft-dark ${
                  feedback === "idle" ? "hover:text-ink dark:hover:text-ink-dark" : ""
                } ${
                  canAdvance
                    ? "pointer-events-none spin-slow opacity-40"
                    : awaitingRetype
                      ? "pointer-events-none opacity-40"
                      : ""
                }`}
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
