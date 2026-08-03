import { useEffect, useState } from "react";

// iOS Safari's `100dvh` doesn't shrink for the on-screen keyboard — it only
// accounts for browser chrome (the address bar), not the keyboard — so a
// bottom-anchored element positioned via dvh/bottom-4 alone can end up
// genuinely hidden behind the keyboard there, not just cramped. The
// VisualViewport API reports the real visible area regardless, so this
// tracks it directly instead of trusting dvh.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      const covered = window.innerHeight - vv!.height - vv!.offsetTop;
      // Small values are browser-chrome jitter (address bar show/hide on
      // scroll), not a keyboard — ignore anything under a real keyboard's
      // minimum height.
      setInset(covered > 60 ? Math.round(covered) : 0);
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
