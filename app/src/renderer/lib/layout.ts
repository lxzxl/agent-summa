// Layout constants + the persisted (resizable) list-column width.

export const RAIL = 58; // fixed-width icon activity rail (not resizable)
export const THEMES = ["terminal", "graphite", "spotlight"] as const;
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
