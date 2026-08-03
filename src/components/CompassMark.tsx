// A compact version of the compass rose already used as page decoration —
// reused here as the closest thing this app has to a brand mark, rather
// than inventing a second, unrelated icon.
export function CompassMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <g stroke="currentColor" strokeWidth="1">
        <line x1="12" y1="1" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="23" />
        <line x1="1" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="23" y2="12" />
      </g>
      <polygon points="12,3.5 13.6,12 12,20.5 10.4,12" fill="currentColor" />
    </svg>
  );
}
