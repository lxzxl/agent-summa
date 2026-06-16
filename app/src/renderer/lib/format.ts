// Small pure formatters shared across the renderer.

/** Relative age: "now" / "5m" / "3h" / "2d". */
export function rel(ms: number | null): string {
  if (!ms) return "—";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Last path segment (basename) of a path, or null. */
export const base = (p: string | null): string | null => (p ? (p.split("/").pop() ?? p) : null);

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const pad = (n: number): string => String(n).padStart(2, "0");

/** "MM-DD HH:MM" (short timestamp for message rows). */
export function fmtTs(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD HH:MM" (full timestamp for detail headers / tooltips). */
export function fmtFull(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
