import { useEffect, useRef, useState, type FormEvent } from "react";
import { countries, type Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { SoundToggle } from "../../components/SoundToggle";
import { isCloseMatch } from "../../core/fuzzyMatch";
import { accentSolidClass } from "../../core/palette";
import { comboClass } from "../../core/combo";
import { playCorrect, playIncorrect } from "../../core/sound";
import { MAP_ALWAYS_INSET, MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import { roastFor } from "../../data/roasts";
import {
  borderExpectedAnswer,
  borderMatchCandidates,
  borderPromptFor,
  borderQuestionKey,
  borderQuestionMissCount,
  buildBorderQueue,
  recordBorderAttempt,
  ROAST_MISS_THRESHOLD,
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
}

export function BorderPlay({
  pool,
  typeSetting,
  sessionType,
  showMap,
  onExit,
}: {
  pool: Country[];
  typeSetting: BorderQuestionTypeSetting;
  sessionType: SessionType;
  showMap: boolean;
  onExit: (result: BorderResult | null) => void;
}) {
  const [queue, setQueue] = useState<BorderQuestion[]>(() => buildBorderQueue(pool, typeSetting));
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "correct" | "incorrect">("idle");
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [combo, setCombo] = useState(0);
  const [roastMessage, setRoastMessage] = useState<string | null>(null);
  // Countries whose question has been fully answered correctly / answered
  // wrong (or given up on) — same "current vs wrong vs done" map convention
  // as the other modes, keyed to the question's *subject* country.
  const [completedCcn3s, setCompletedCcn3s] = useState<Set<string>>(new Set());
  const [wrongCcn3s, setWrongCcn3s] = useState<Set<string>>(new Set());
  // "name-neighbors" only — which of the current question's neighbors have
  // been typed in so far. Reset whenever the current question changes.
  const [foundNeighborCca3s, setFoundNeighborCca3s] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<{ kind: "already" | "unknown" | "wrong"; text: string } | null>(null);

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

  useEffect(() => {
    setFoundNeighborCca3s(new Set());
  }, [currentKey]);

  useEffect(() => {
    if (feedback === "idle") inputRef.current?.focus();
    else nextButtonRef.current?.focus();
  }, [feedback, currentKey]);

  // A correct answer auto-advances after a beat; an incorrect one waits for
  // a manual Next. Same reasoning as the other modes: see the "Play-screen
  // answer panel pattern" note in CLAUDE.md.
  useEffect(() => {
    if (feedback !== "correct") return;
    const timeout = setTimeout(() => advanceRef.current(), 800);
    return () => clearTimeout(timeout);
  }, [feedback, currentKey]);

  useEffect(() => {
    if (feedback !== "incorrect") return;
    const timeout = setTimeout(() => setInput(""), 350);
    return () => clearTimeout(timeout);
  }, [feedback, currentKey]);

  function submitAnswer(answer: string) {
    if (!current) return;
    const correct = isCloseMatch(answer, borderMatchCandidates(current));
    recordBorderAttempt(current, correct);
    if (correct) {
      playCorrect();
      setCombo((c) => c + 1);
      setRoastMessage(null);
    } else {
      playIncorrect();
      setCombo(0);
      const misses = borderQuestionMissCount(current);
      setRoastMessage(misses >= ROAST_MISS_THRESHOLD ? roastFor(current.country.name) : null);
    }
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
    if (nextFound.size === current.neighbors.length) {
      recordBorderAttempt(current, true);
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
    const nextQueue = requeue ? [...rest, current] : rest;
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
    setRoastMessage(null);
    setHint(null);
    if (nextQueue.length === 0) onExit(score);
  }

  // For "name-neighbors" specifically: give up on this country (not the
  // whole session) — reveals whatever's left, records the miss, and moves
  // on to the next question, same shape as advance() after a wrong answer.
  function giveUpOnCurrent() {
    if (!current || !isNameNeighbors) return;
    if (foundNeighborCca3s.size < current.neighbors.length) {
      recordBorderAttempt(current, false);
      const misses = borderQuestionMissCount(current);
      setRoastMessage(misses >= ROAST_MISS_THRESHOLD ? roastFor(current.country.name) : null);
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

  function giveUpSession() {
    const remaining =
      sessionType === "learn"
        ? queue.map((q) => ({
            cca3: q.country.cca3,
            region: q.country.region,
            label: borderExpectedAnswer(q) || q.country.name,
            flag: q.country.flag,
          }))
        : undefined;
    onExit({ ...score, remaining });
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
      if (feedback === "idle") submitNeighbor(input);
      else advance();
      return;
    }
    if (feedback === "idle") {
      if (!input.trim()) return;
      submitAnswer(input);
    } else {
      advance();
    }
  }

  if (!current) return null;

  const skippedPending = queue.filter((q) => skippedKeys.has(borderQuestionKey(q)));

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
          className="h-full w-full portrait:w-auto"
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
          <SoundToggle />
          {skippedPending.length > 0 && (
            <button
              onClick={() => setShowSkipped((s) => !s)}
              className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink-soft shadow-sm backdrop-blur hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
            >
              Skipped ({skippedPending.length})
            </button>
          )}
          {combo >= 2 && (
            <span
              className={`pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 shadow-sm backdrop-blur dark:bg-paper-card-dark/95 ${comboClass(combo)}`}
            >
              🔥 ×{combo}
            </span>
          )}
          <span className="pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 text-ink shadow-sm backdrop-blur dark:bg-paper-card-dark/95 dark:text-ink-dark">
            {sessionType === "quiz" ? `${score.correct} / ${score.total} correct` : `${queue.length} left`}
          </span>
        </div>
      </div>

      {showSkipped ? (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
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
      ) : (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 ${!showMap ? "top-16" : ""}`}
        >
          <form onSubmit={handleSubmit} className="pointer-events-auto w-full max-w-md space-y-2">
            <div className="flex overflow-hidden rounded-md bg-paper-card/95 shadow-sm backdrop-blur dark:bg-paper-card-dark/95">
              <div className="flex w-14 shrink-0 items-center justify-center border-r-2 border-dashed border-border py-3 text-2xl dark:border-border-dark">
                {safeToReveal ? current.country.flag : "🌐"}
              </div>
              <div className="flex flex-1 items-center justify-center px-4 py-3 text-center">
                {feedback === "incorrect" ? (
                  <div className="space-y-1">
                    {roastMessage && (
                      <p className="text-xs italic text-ink-soft dark:text-ink-soft-dark">{roastMessage}</p>
                    )}
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
                        Not quite — it's {borderExpectedAnswer(current)}.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="font-serif text-lg text-ink dark:text-ink-dark">{borderPromptFor(current)}</p>
                )}
              </div>
            </div>

            {isNameNeighbors && feedback === "idle" && (
              <p className="text-center text-xs uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark">
                {foundNeighborCca3s.size} / {current.neighbors.length} found
              </p>
            )}

            {hint && isNameNeighbors && feedback === "idle" && (
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
                onClick={isNameNeighbors ? giveUpOnCurrent : giveUpSession}
                disabled={feedback !== "idle"}
                title={isNameNeighbors ? "Give up on this one" : "Give up"}
                aria-label={isNameNeighbors ? "Give up on this one" : "Give up"}
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper-card/95 text-cat-red shadow-sm backdrop-blur transition-opacity duration-300 hover:scale-105 dark:bg-paper-card-dark/95 dark:text-cat-red-dark ${
                  feedback === "idle" ? "opacity-100" : "pointer-events-none spin-slow opacity-40"
                }`}
              >
                🏳️
              </button>

              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  readOnly={feedback !== "idle"}
                  placeholder={isNameNeighbors ? "Type a country" : "Type your answer"}
                  className={`w-full rounded-full border bg-paper-card/95 py-3 pl-5 pr-14 text-center text-lg text-ink shadow-lg outline-none backdrop-blur focus:ring-2 focus:ring-cat-blue dark:bg-paper-card-dark/95 dark:text-ink-dark dark:focus:ring-cat-red-dark ${
                    feedback === "correct" ? "border-cat-green dark:border-cat-green-dark" : "border-border dark:border-border-dark"
                  } ${feedback === "incorrect" || hint?.kind === "wrong" || hint?.kind === "unknown" ? "shake-subtle" : ""}`}
                />
                {feedback === "idle" && (
                  <button
                    type="submit"
                    aria-label="Submit answer"
                    className={`absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105 ${accentSolidClass(ACCENT)}`}
                  >
                    ✈
                  </button>
                )}
                {feedback === "correct" && (
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
                  else if (feedback === "incorrect") advance();
                }}
                disabled={feedback === "correct"}
                title={feedback === "incorrect" ? "Next question" : "Skip"}
                aria-label={feedback === "incorrect" ? "Next question" : "Skip"}
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full shadow-sm transition-all duration-300 hover:scale-105 ${
                  feedback === "incorrect"
                    ? `text-white shadow-md ${accentSolidClass(ACCENT)}`
                    : "bg-paper-card/95 text-ink-soft backdrop-blur hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark"
                } ${feedback === "correct" ? "pointer-events-none spin-slow opacity-40" : ""}`}
              >
                {feedback === "incorrect" ? "→" : "⏭"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
