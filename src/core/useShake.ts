import { useEffect, useState } from "react";

// A one-shot shake trigger, replayable on demand — e.g. call `trigger()` on
// every failed retype attempt, even several in a row while some other piece
// of state (like "feedback is incorrect") hasn't changed since the last
// one. A plain boolean derived straight from that state can only ever go
// false→true once; this increments a key instead, so each call gets its own
// fresh true→false→true cycle regardless of what else did or didn't change.
export function useShake(durationMs = 350): { shaking: boolean; trigger: () => void } {
  const [key, setKey] = useState(0);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (key === 0) return;
    setShaking(true);
    const timeout = setTimeout(() => setShaking(false), durationMs);
    return () => clearTimeout(timeout);
  }, [key, durationMs]);

  return { shaking, trigger: () => setKey((k) => k + 1) };
}
