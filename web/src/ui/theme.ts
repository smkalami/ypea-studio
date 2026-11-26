// The theme: the system's preference unless the user chose light or dark. The choice is kept
// in this browser. A small script in the page head applies it before the first paint.

export type Theme = "system" | "light" | "dark";
const KEY = "ypea-studio-theme";

export function storedTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system"; // storage is blocked: follow the system
  }
}

export function applyTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // the choice then lasts until the page is closed
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
