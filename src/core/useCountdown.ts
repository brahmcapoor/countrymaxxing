import { useEffect, useRef, useState } from "react";

/**
 * Counts down from `totalSeconds`, calling `onExpire` once it hits zero.
 * Pass `null` to disable the timer entirely (returns 0, never fires).
 * Uses elapsed wall-clock time rather than decrementing per-tick, so it
 * doesn't drift if the tab is backgrounded or a tick is delayed.
 *
 * Restarts whenever `totalSeconds` changes. Callers that need a fresh
 * countdown each session (without the duration value itself changing)
 * should mount this in a component that remounts per session, rather than
 * one that persists across sessions.
 */
export function useCountdown(totalSeconds: number | null, onExpire: () => void): number {
  const [remaining, setRemaining] = useState(totalSeconds ?? 0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (totalSeconds === null) return;
    setRemaining(totalSeconds);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, totalSeconds - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(interval);
        onExpireRef.current();
      }
    }, 250);
    return () => clearInterval(interval);
  }, [totalSeconds]);

  return remaining;
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
