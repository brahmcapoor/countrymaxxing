export type Theme = "light" | "dark";

const THEME_KEY = "countrymaxxing:theme";

function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// The stored choice wins once the user has explicitly picked one; until
// then this follows the OS/browser preference, same as before this toggle
// existed.
export function getEffectiveTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

function applyTheme(theme: Theme): void {
  // color-scheme (native form controls, scrollbars) follows via the
  // `:root.dark` CSS rule keyed off this same class — see index.css.
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Best-effort — the theme still applies for this page load even if it
    // can't persist across visits (e.g. private browsing).
  }
  applyTheme(theme);
}

// Applies the effective theme on load, then — only while no explicit choice
// has been made — keeps following live OS-level theme changes, the same
// live-follow behavior the CSS-only media query gave for free before this
// existed.
export function initTheme(): void {
  applyTheme(getEffectiveTheme());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (getStoredTheme() !== null) return;
    applyTheme(e.matches ? "dark" : "light");
  });
}
