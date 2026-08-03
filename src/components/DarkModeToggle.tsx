import { useState } from "react";
import { getEffectiveTheme, setTheme } from "../core/theme";

export function DarkModeToggle({ className }: { className?: string }) {
  const [theme, setThemeState] = useState(getEffectiveTheme());

  return (
    <button
      type="button"
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        setThemeState(next);
        setTheme(next);
      }}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={theme === "dark"}
      className={
        className ??
        "pointer-events-auto rounded-full bg-paper-card/95 px-3 py-1.5 shadow-sm backdrop-blur dark:bg-paper-card-dark/95"
      }
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
