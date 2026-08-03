import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { accentSolidClass, type CategoricalHue } from "../core/palette";

const HANDLE_SIZE = 56; // px
const COMPLETE_RATIO = 0.82; // how far across the track counts as "departed"

// A drag-to-confirm control (Pointer Events cover mouse/touch/pen alike, so
// no separate mobile-only code path is needed) — replaced an earlier
// boarding-pass "tear" animation on Depart that turned out not to render at
// all in Safari. Mouse/touch users drag the plane across; keyboard users
// tab to it and press Enter/Space, which completes immediately rather than
// requiring an actual drag gesture from a keyboard.
export function SlideToDepart({
  label,
  sublabel,
  disabled,
  accent,
  onComplete,
}: {
  label: string;
  sublabel?: string;
  disabled?: boolean;
  accent: CategoricalHue;
  onComplete: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startXRef = useRef(0);
  const maxXRef = useRef(0);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || completed) return;
    const track = trackRef.current;
    if (!track) return;
    maxXRef.current = track.clientWidth - HANDLE_SIZE - 8; // 8 = handle's inset from the track edge
    startXRef.current = e.clientX - dragX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = Math.min(Math.max(e.clientX - startXRef.current, 0), maxXRef.current);
    setDragX(next);
  }

  function finishDrag() {
    if (!dragging) return;
    setDragging(false);
    const ratio = maxXRef.current > 0 ? dragX / maxXRef.current : 0;
    if (ratio >= COMPLETE_RATIO) {
      setCompleted(true);
      setDragX(maxXRef.current);
      onComplete();
    } else {
      setDragX(0);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || completed) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const track = trackRef.current;
    if (track) maxXRef.current = track.clientWidth - HANDLE_SIZE - 8;
    setCompleted(true);
    setDragX(maxXRef.current);
    onComplete();
  }

  const progress = maxXRef.current > 0 ? dragX / maxXRef.current : 0;

  return (
    <div
      ref={trackRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={`relative mt-10 h-16 select-none overflow-hidden rounded-2xl shadow-lg transition-opacity duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
        disabled ? "cursor-not-allowed opacity-40" : ""
      } ${accentSolidClass(accent)}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 bg-black/10"
        style={{
          width: `${dragX + HANDLE_SIZE}px`,
          transition: dragging ? "none" : "width 0.22s ease-out",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-white"
        style={{ opacity: 1 - progress * 0.8 }}
      >
        <span className="font-label text-base font-bold uppercase tracking-wide">{label}</span>
        {sublabel && <span className="text-xs font-normal opacity-85">{sublabel}</span>}
      </div>
      {!disabled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-normal uppercase tracking-wide text-white/70"
        >
          Slide →
        </span>
      )}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={`absolute left-1 top-1 flex h-14 w-14 items-center justify-center rounded-xl bg-white text-xl text-ink shadow-md dark:text-ink-dark ${
          disabled ? "" : "cursor-grab active:cursor-grabbing"
        }`}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 0.22s ease-out",
        }}
      >
        ✈
      </div>
    </div>
  );
}
