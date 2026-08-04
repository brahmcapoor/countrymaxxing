import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Country } from "../../data/countries";
import { WorldMap } from "../../components/WorldMap";
import { SoundToggle } from "../../components/SoundToggle";
import { DarkModeToggle } from "../../components/DarkModeToggle";
import { isCloseMatch, isExactMatch } from "../../core/fuzzyMatch";
import { accentSolidClass } from "../../core/palette";
import { comboClass, comboEmoji, comboTier } from "../../core/combo";
import { playCorrect, playIncorrect } from "../../core/sound";
import { useKeyboardInset } from "../../core/useKeyboardInset";
import { MAP_ALWAYS_INSET, MAP_HARD_TO_RENDER } from "../../data/mapCoverage";
import { buildMapIdentifyQueue, recordMapIdentifyAttempt, type SessionType } from "./engine";

const ACCENT = "red"; // matches CountryMaxxing.tsx's accent

interface Result {
  countryCorrect: boolean;
  capitalCorrect: boolean;
}

export interface MapIdentifyResult {
  correct: number;
  total: number;
  /** Names still not answered correctly — present only on an early give-up
   * in Learn mode, where "all mastered" wouldn't be true. cca3/region ride
   * along so the summary screen can group these by region the same way
   * Manifest's summary does. */
  remaining?: { cca3: string; region: string; label: string; flag: string }[];
}

export function MapIdentifyPlay({
  pool,
  askCapital,
  sessionType,
  onExit,
}: {
  pool: Country[];
  askCapital: boolean;
  sessionType: SessionType;
  onExit: (result: MapIdentifyResult | null) => void;
}) {
  const [queue, setQueue] = useState<Country[]>(() => buildMapIdentifyQueue(pool));
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const [countryInput, setCountryInput] = useState("");
  const [capitalInput, setCapitalInput] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "answered">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [combo, setCombo] = useState(0);
  // See PromptAndAnswerPlay.tsx's matching comment — distinguishes "you
  // tried and missed" copy/shake from "you asked to be shown."
  const [gaveUp, setGaveUp] = useState(false);

  // See PromptAndAnswerPlay.tsx's matching comment — same iOS Safari
  // keyboard-covers-input fix. Unlike the other modes, the map here is NOT
  // shrunk while typing — it's the actual question (you're identifying the
  // highlighted country), so hiding more of it while answering would work
  // against the mode instead of just tidying up space.
  const keyboardInset = useKeyboardInset();
  const bottomBarStyle = keyboardInset > 0 ? { bottom: keyboardInset + 16 } : undefined;

  const countryInputRef = useRef<HTMLInputElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  // Always points at the latest advance() closure so the auto-advance timer
  // below never fires a stale one (e.g. after jumping to a skipped country).
  const advanceRef = useRef<() => void>(() => {});

  const poolCcn3s = useRef(new Set(pool.map((c) => c.ccn3))).current;
  // Kiribati (in MAP_ALWAYS_INSET) is deliberately excluded here — Map
  // Identify shows its real scattered shape via the auto-zoom inset instead
  // of collapsing it to a marker, since seeing the true geometry is the
  // point when it's literally the thing being identified.
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
  // `advance` is a hoisted function declaration below — assigning it here
  // every render keeps the ref current before any effect can read it.
  advanceRef.current = advance;

  useEffect(() => {
    if (feedback === "idle") countryInputRef.current?.focus();
    else nextButtonRef.current?.focus();
  }, [feedback, current?.cca3]);

  // A fully correct answer auto-advances after a beat; anything wrong waits
  // for a manual Next so there's time to read the correction. The effect's
  // own cleanup (on feedback/cca3 change) cancels a pending timer — no
  // manual clearing needed in advance()/skip()/jumpTo().
  useEffect(() => {
    if (feedback !== "answered" || !result?.countryCorrect || !(result.capitalCorrect || !askCapital)) return;
    const timeout = setTimeout(() => advanceRef.current(), 800);
    return () => clearTimeout(timeout);
  }, [feedback, current?.cca3, result, askCapital]);

  // Whichever field(s) were wrong shake themselves clear rather than sitting
  // there readOnly with the wrong guess — a correct field stays put since
  // there's nothing to fix there.
  useEffect(() => {
    if (feedback !== "answered" || !result) return;
    const timeout = setTimeout(() => {
      if (!result.countryCorrect) setCountryInput("");
      if (askCapital && !result.capitalCorrect) setCapitalInput("");
    }, 350);
    return () => clearTimeout(timeout);
  }, [feedback, current?.cca3, result, askCapital]);

  function submitAnswer(nextCountryInput: string, nextCapitalInput: string) {
    if (!current) return;
    const countryCorrect = isCloseMatch(nextCountryInput, [current.name, ...current.altNames]);
    const capitalCorrect = !askCapital || isCloseMatch(nextCapitalInput, current.capitals);
    recordMapIdentifyAttempt(current, countryCorrect, askCapital, capitalCorrect);
    const fullyCorrect = countryCorrect && capitalCorrect;
    if (fullyCorrect) {
      playCorrect();
      setCombo((c) => c + 1);
    } else {
      playIncorrect();
      setCombo(0);
    }
    setResult({ countryCorrect, capitalCorrect });
    setScore((s) => ({ correct: s.correct + (fullyCorrect ? 1 : 0), total: s.total + 1 }));
    setFeedback("answered");
  }

  function advance() {
    if (!current) return;
    const requeue = sessionType === "learn" && !(result?.countryCorrect && (result?.capitalCorrect ?? true));
    const rest = queue.slice(1);
    const nextQueue = requeue ? [...rest, current] : rest;

    setSkippedKeys((prev) => {
      const next = new Set(prev);
      next.delete(current.cca3);
      return next;
    });
    setQueue(nextQueue);
    setCountryInput("");
    setCapitalInput("");
    setResult(null);
    setFeedback("idle");
    setGaveUp(false);
    if (nextQueue.length === 0) onExit(score);
  }

  function skip() {
    if (!current || feedback !== "idle") return;
    const rest = queue.slice(1);
    setSkippedKeys((prev) => new Set(prev).add(current.cca3));
    setQueue([...rest, current]);
    setCountryInput("");
    setCapitalInput("");
  }

  function jumpTo(target: Country) {
    setQueue((q) => [target, ...q.filter((c) => c.cca3 !== target.cca3)]);
    setCountryInput("");
    setCapitalInput("");
    setResult(null);
    setFeedback("idle");
    setShowSkipped(false);
  }

  // Reveals this question's answer and counts it as a miss, then continues
  // the round via the same path a real wrong guess takes — Skip is for "I
  // think I can get this later," Give Up is for "just show me."
  function giveUp() {
    if (!current || feedback !== "idle") return;
    setGaveUp(true);
    submitAnswer("", "");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (feedback === "idle") {
      if (!countryInput.trim() || (askCapital && !capitalInput.trim())) return;
      submitAnswer(countryInput, capitalInput);
    } else {
      advance();
    }
  }

  function maybeAutoSubmit(nextCountryInput: string, nextCapitalInput: string) {
    if (!current || feedback !== "idle") return;
    const countryOk = isExactMatch(nextCountryInput, [current.name, ...current.altNames]);
    const capitalOk = !askCapital || isExactMatch(nextCapitalInput, current.capitals);
    if (countryOk && capitalOk) submitAnswer(nextCountryInput, nextCapitalInput);
  }

  if (!current) return null;

  const skippedPending = queue.filter((c) => skippedKeys.has(c.cca3));
  const filledCcn3s = new Set([current.ccn3]);

  return (
    // Full viewport height — see the matching comment in PromptAndAnswerPlay.tsx
    // about the coupling to App.tsx's (currently absent) shelf header.
    <div className="relative h-dvh animate-[swoop-in_0.5s_ease-out] bg-paper dark:bg-paper-dark">
      <WorldMap
        filledCcn3s={filledCcn3s}
        focusCcn3s={poolCcn3s}
        pointCountries={pointCountries}
        autoZoomCcn3={current.ccn3}
        alwaysInsetCcn3s={alwaysInsetCcn3s}
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
            <p className="mb-3 text-sm font-medium text-ink dark:text-ink-dark">Skipped countries</p>
            <ul className="space-y-2">
              {skippedPending.map((c) => (
                <li key={c.cca3} className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft dark:text-ink-soft-dark">Highlighted country</span>
                  <button
                    onClick={() => jumpTo(c)}
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
          className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
          style={bottomBarStyle}
        >
          <form onSubmit={handleSubmit} className="pointer-events-auto w-full max-w-md">
            <div className="relative flex items-center gap-2">
              {feedback === "answered" && result && (
                <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 space-y-1 rounded-md bg-paper-card/95 p-2 text-center text-sm shadow-sm backdrop-blur dark:bg-paper-card-dark/95">
                  <p
                    className={
                      result.countryCorrect
                        ? "text-cat-green dark:text-cat-green-dark"
                        : "text-cat-red dark:text-cat-red-dark"
                    }
                  >
                    {result.countryCorrect
                      ? `Correct! ${current.flag}`
                      : gaveUp
                        ? `It's ${current.name}. ${current.flag}`
                        : `Not quite — it's ${current.name}. ${current.flag}`}
                  </p>
                  {askCapital && (
                    <p
                      className={
                        result.capitalCorrect
                          ? "text-cat-green dark:text-cat-green-dark"
                          : "text-cat-red dark:text-cat-red-dark"
                      }
                    >
                      {result.capitalCorrect ? "Capital correct!" : `Capital: it's ${current.capital}.`}
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={giveUp}
                disabled={feedback !== "idle"}
                title="Give up on this one"
                aria-label="Give up on this one"
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper-card/95 text-cat-red shadow-sm backdrop-blur transition-opacity duration-300 hover:scale-105 dark:bg-paper-card-dark/95 dark:text-cat-red-dark ${
                  feedback === "idle" ? "opacity-100" : "pointer-events-none spin-slow opacity-40"
                }`}
              >
                🏳️
              </button>

              <div className="flex-1 space-y-2">
                <div className="relative">
                  <input
                    ref={countryInputRef}
                    value={countryInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCountryInput(value);
                      maybeAutoSubmit(value, capitalInput);
                    }}
                    readOnly={feedback !== "idle"}
                    placeholder="Which country is highlighted?"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className={`w-full rounded-full border bg-paper-card/95 py-3 pl-5 text-center text-lg text-ink shadow-lg outline-none backdrop-blur focus:ring-2 focus:ring-cat-blue dark:bg-paper-card-dark/95 dark:text-ink-dark dark:focus:ring-cat-red-dark ${askCapital ? "pr-5" : "pr-14"} ${
                      feedback === "answered" && result
                        ? result.countryCorrect
                          ? "border-cat-green dark:border-cat-green-dark"
                          : `border-border dark:border-border-dark ${gaveUp ? "" : "shake-subtle"}`
                        : "border-border dark:border-border-dark"
                    }`}
                  />
                  {feedback === "idle" && !askCapital && (
                    <button
                      type="submit"
                      aria-label="Submit answer"
                      className={`absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105 ${accentSolidClass(ACCENT)}`}
                    >
                      ✈
                    </button>
                  )}
                </div>
                {askCapital && (
                  <div className="relative">
                    <input
                      value={capitalInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCapitalInput(value);
                        maybeAutoSubmit(countryInput, value);
                      }}
                      readOnly={feedback !== "idle"}
                      placeholder="And its capital?"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className={`w-full rounded-full border bg-paper-card/95 py-3 pl-5 pr-14 text-center text-lg text-ink shadow-lg outline-none backdrop-blur focus:ring-2 focus:ring-cat-blue dark:bg-paper-card-dark/95 dark:text-ink-dark dark:focus:ring-cat-red-dark ${
                        feedback === "answered" && result
                          ? result.capitalCorrect
                            ? "border-cat-green dark:border-cat-green-dark"
                            : `border-border dark:border-border-dark ${gaveUp ? "" : "shake-subtle"}`
                          : "border-border dark:border-border-dark"
                      }`}
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
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={skip}
                disabled={feedback !== "idle"}
                title="Skip"
                aria-label="Skip"
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper-card/95 text-ink-soft shadow-sm backdrop-blur transition-opacity duration-300 hover:scale-105 hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark ${
                  feedback === "idle" ? "opacity-100" : "pointer-events-none spin-slow opacity-40"
                }`}
              >
                ⏭
              </button>

              <div className="pointer-events-none absolute inset-x-0 top-full z-10 mt-2">
                <button
                  ref={nextButtonRef}
                  type="submit"
                  disabled={feedback !== "answered"}
                  tabIndex={feedback === "answered" ? 0 : -1}
                  className={`w-full cursor-pointer rounded-full py-3 font-medium text-white shadow-lg transition-all duration-300 hover:opacity-90 ${accentSolidClass(ACCENT)} ${
                    feedback === "answered"
                      ? "pointer-events-auto translate-y-0 opacity-100"
                      : "pointer-events-none -translate-y-1 opacity-0"
                  }`}
                >
                  Next question
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
