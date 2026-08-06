import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { withArticle, type Country } from "../../data/countries";
import { CountrySilhouette } from "../../components/CountrySilhouette";
import { SoundToggle } from "../../components/SoundToggle";
import { DarkModeToggle } from "../../components/DarkModeToggle";
import { accentSolidClass } from "../../core/palette";
import { comboClass, comboEmoji, comboTier } from "../../core/combo";
import { playCorrect, playIncorrect } from "../../core/sound";
import { useShake } from "../../core/useShake";
import {
  reviewList,
  useCategoryTally,
  useSessionTally,
  type CategoryBreakdownEntry,
  type TalliedItem,
} from "../../core/sessionTally";
import { ReviewItemsList } from "./ReviewDrawer";
import {
  buildSizeCompareQueue,
  generateScaleOptions,
  recordSizeCompareAttempt,
  requeueAfterMiss,
  type ScaleOption,
  type SessionType,
  type SizeCompareQuestion,
} from "./engine";

const ACCENT = "red"; // matches CountryMaxxing.tsx's accent

// The unscaled "1 unit" footprint every CountrySilhouette instance shares —
// reference and every option card use this exact same className so a
// candidate rendered at displayScale=1 is literally the same on-screen size
// as the reference, which is what makes "bigger/smaller than the reference"
// readable at a glance.
const SILHOUETTE_BASE_CLASS = "h-24 w-24";

export interface SizeCompareResult {
  correct: number;
  total: number;
  /** Present only on an early give-up in Learn mode — see MapIdentifyResult's
   * matching field. Never populated here (no per-question give-up exists in
   * this mode, only Skip), same as MapIdentifyPlay's own remaining. */
  remaining?: { cca3: string; region: string; label: string; flag: string }[];
  sessionTally: TalliedItem[];
  /** Accuracy split by the candidate's region — this mode has only one
   * question shape (unlike the others' direction/skill/type axes), so
   * region is the natural, useful breakdown, mirroring the setup screen's
   * own region filter. */
  regionBreakdown: CategoryBreakdownEntry[];
}

export function SizeComparePlay({
  pool,
  sessionType,
  onExit,
}: {
  pool: Country[];
  sessionType: SessionType;
  onExit: (result: SizeCompareResult | null) => void;
}) {
  const [queue, setQueue] = useState<SizeCompareQuestion[]>(() => buildSizeCompareQueue(pool));
  const [options, setOptions] = useState<ScaleOption[]>(() => generateScaleOptions(queue[0]?.trueScale ?? 1));
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "answered">("idle");
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [combo, setCombo] = useState(0);
  const { shaking, trigger: triggerShake } = useShake();
  const sessionTally = useSessionTally();
  const regionTally = useCategoryTally();

  // Always points at the latest advance() closure, same stale-closure
  // guard the other three play screens use for their auto-advance timers.
  const advanceRef = useRef<() => void>(() => {});

  const current = queue[0] ?? null;
  advanceRef.current = advance;

  // Auto-advance fires once the reveal tween has had time to actually
  // play (CountrySilhouette's own transition is 0.8s) plus a beat to read
  // the result — longer than the other modes' flat 800ms since there's an
  // animation to watch first, not just text to read.
  useEffect(() => {
    if (!revealed) return;
    const timeout = setTimeout(() => advanceRef.current(), 1400);
    return () => clearTimeout(timeout);
  }, [revealed, current?.candidate.cca3]);

  // Short pause between "you tapped this" and "watch it grow/shrink to the
  // true size" — an instant snap would read as a glitch, not a reveal.
  useEffect(() => {
    if (feedback !== "answered") return;
    const timeout = setTimeout(() => setRevealed(true), 350);
    return () => clearTimeout(timeout);
  }, [feedback, current?.candidate.cca3]);

  function pick(index: number) {
    if (!current || feedback !== "idle") return;
    const option = options[index]!;
    recordSizeCompareAttempt(current.candidate, option.correct);
    sessionTally.record(
      { cca3: current.candidate.cca3, label: current.candidate.name, flag: current.candidate.flag },
      option.correct,
      false,
    );
    regionTally.record(current.candidate.region, option.correct);
    if (option.correct) {
      playCorrect();
      setCombo((c) => c + 1);
    } else {
      playIncorrect();
      setCombo(0);
      triggerShake();
    }
    setPickedIndex(index);
    setScore((s) => ({ correct: s.correct + (option.correct ? 1 : 0), total: s.total + 1 }));
    setFeedback("answered");
  }

  function advance() {
    if (!current) return;
    const requeue = sessionType === "learn" && !options[pickedIndex ?? -1]?.correct;
    const rest = queue.slice(1);
    const nextQueue = requeue ? requeueAfterMiss(rest, current) : rest;

    setSkippedKeys((prev) => {
      const next = new Set(prev);
      next.delete(current.candidate.cca3);
      return next;
    });
    setQueue(nextQueue);
    setOptions(generateScaleOptions(nextQueue[0]?.trueScale ?? 1));
    setFeedback("idle");
    setPickedIndex(null);
    setRevealed(false);
    if (nextQueue.length === 0) {
      onExit({ ...score, sessionTally: sessionTally.getItems(), regionBreakdown: regionTally.getBreakdown() });
    }
  }

  function skip() {
    if (!current || feedback !== "idle") return;
    const rest = queue.slice(1);
    setSkippedKeys((prev) => new Set(prev).add(current.candidate.cca3));
    const nextQueue = [...rest, current];
    setQueue(nextQueue);
    setOptions(generateScaleOptions(nextQueue[0]?.trueScale ?? 1));
  }

  function jumpTo(target: SizeCompareQuestion) {
    setQueue((q) => [target, ...q.filter((question) => question.candidate.cca3 !== target.candidate.cca3)]);
    setOptions(generateScaleOptions(target.trueScale));
    setFeedback("idle");
    setPickedIndex(null);
    setRevealed(false);
    setShowSkipped(false);
  }

  if (!current) return null;

  const skippedPending = queue.filter((q) => skippedKeys.has(q.candidate.cca3));
  const reviewItems = reviewList(sessionTally.getItems());

  return (
    <div className="relative flex h-dvh animate-[swoop-in_0.5s_ease-out] flex-col bg-paper dark:bg-paper-dark">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 text-sm">
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

      {showSkipped || showReview ? (
        <div className="flex flex-1 items-center justify-center px-4 pt-16">
          <AnimatePresence mode="wait" initial={false}>
            {showSkipped ? (
              <motion.div
                key="skipped"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-md rounded-md border border-border bg-paper-card/95 p-4 shadow-lg backdrop-blur dark:border-border-dark dark:bg-paper-card-dark/95"
              >
                <p className="mb-3 text-sm font-medium text-ink dark:text-ink-dark">Skipped comparisons</p>
                <ul className="space-y-2">
                  {skippedPending.map((q) => (
                    <li key={q.candidate.cca3} className="flex items-center justify-between text-sm">
                      <span className="text-ink-soft dark:text-ink-soft-dark">
                        {q.candidate.name} vs. {q.reference.name}
                      </span>
                      <button
                        onClick={() => jumpTo(q)}
                        className={`ml-3 shrink-0 rounded px-2 py-1 text-xs text-white ${accentSolidClass(ACCENT)}`}
                      >
                        Try now
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-md rounded-md border border-border bg-paper-card/95 p-4 shadow-lg backdrop-blur dark:border-border-dark dark:bg-paper-card-dark/95"
              >
                <p className="mb-3 text-sm font-medium text-ink dark:text-ink-dark">Review so far</p>
                <ReviewItemsList items={reviewItems} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pt-16 pb-8">
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-ink-soft uppercase dark:text-ink-soft-dark">
              Reference
            </p>
            <div className="flex h-28 w-28 items-center justify-center">
              <CountrySilhouette
                country={current.reference}
                displayScale={1}
                className={`${SILHOUETTE_BASE_CLASS} text-ink-soft dark:text-ink-soft-dark`}
              />
            </div>
            <p className="text-lg font-medium text-ink dark:text-ink-dark">{withArticle(current.reference)}</p>
          </div>

          <p className="text-center text-ink dark:text-ink-dark">
            How big is <strong>{withArticle(current.candidate)}</strong>, really?
          </p>

          <div className="flex items-end justify-center gap-4">
            {options.map((option, index) => {
              const isPicked = pickedIndex === index;
              const displayScale = isPicked && revealed ? current.trueScale : option.value;
              const state =
                feedback === "idle" ? "idle" : isPicked ? (option.correct ? "correct" : "incorrect") : "dimmed";
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => pick(index)}
                  disabled={feedback !== "idle"}
                  className={`relative flex h-40 w-40 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 bg-paper-card/95 shadow-sm backdrop-blur transition-colors duration-300 dark:bg-paper-card-dark/95 ${
                    state === "correct"
                      ? "border-cat-green dark:border-cat-green-dark"
                      : state === "incorrect"
                        ? `border-cat-red dark:border-cat-red-dark ${shaking ? "shake-subtle" : ""}`
                        : "border-border dark:border-border-dark"
                  } ${state === "dimmed" ? "pointer-events-none opacity-40" : ""}`}
                >
                  <CountrySilhouette
                    country={current.candidate}
                    displayScale={displayScale}
                    className={`${SILHOUETTE_BASE_CLASS} text-cat-red dark:text-cat-red-dark`}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={skip}
            disabled={feedback !== "idle"}
            className={`rounded-full bg-paper-card/95 px-3 py-1.5 text-xs text-ink-soft shadow-sm backdrop-blur transition-opacity duration-300 hover:text-ink dark:bg-paper-card-dark/95 dark:text-ink-soft-dark dark:hover:text-ink-dark ${
              feedback === "idle" ? "opacity-100" : "pointer-events-none opacity-40"
            }`}
          >
            Skip ⏭
          </button>
        </div>
      )}
    </div>
  );
}
