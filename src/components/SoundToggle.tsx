import { useState } from "react";
import { isSoundEnabled, setSoundEnabled } from "../core/sound";

export function SoundToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState(isSoundEnabled());

  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        setSoundEnabled(next);
      }}
      title={enabled ? "Mute sound" : "Unmute sound"}
      aria-pressed={enabled}
      className={
        className ??
        "pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 shadow-sm backdrop-blur dark:bg-paper-card-dark/95"
      }
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
