// Layout constants + the persisted (resizable) list-column width.

export const RAIL = 58; // fixed-width icon activity rail (not resizable)
/** Built-in themes (light first; the first entry is the default). id → `data-theme` value. */
export const THEMES = [
  { id: "github-light", label: "GitHub Light" },
  { id: "solarized-light", label: "Solarized Light" },
  { id: "catppuccin-latte", label: "Catppuccin Latte" },
  { id: "terminal", label: "Terminal" },
  { id: "graphite", label: "Graphite" },
  { id: "spotlight", label: "Spotlight" },
] as const;
export const DEFAULT_THEME = THEMES[0].id; // GitHub Light
export const COLS_KEY = "asum.cols";

const DEFAULT_COLS = { list: 300 }; // session list intentionally narrow → roomy detail

/** Persisted list-column width (the only resizable column; the rail is fixed, detail flexes). */
export function loadCols(): { list: number } {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "") as { list?: unknown };
    if (v && typeof v.list === "number") return { list: v.list };
  } catch {
    /* ignore */
  }
  return DEFAULT_COLS;
}
