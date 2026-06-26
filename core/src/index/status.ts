/**
 * Derive a session's display status — a query-time signal, not a stored field. Pure given an
 * injected FsProbe, so it's unit-testable without a database or Electron. Exactly one status
 * applies, in priority order: active > interrupted > empty > orphaned > none.
 */

export type SessionStatus = "active" | "interrupted" | "empty" | "orphaned";

/** The fields of an indexed session the status rule needs (a narrow, db-agnostic subset). */
export interface StatusInput {
  source: string; // 'cli' | 'app-code' | 'db-backed' | 'vm'
  endedAt: number | null; // epoch ms of the last activity
  rounds: number; // text-bearing user turns
  workspace: string | null; // the session's cwd
  sourcePath: string; // backing file path (or a synthetic id like `opencode:<id>`)
  interrupted: boolean; // already resolved from metadata by the caller
}

/** Filesystem capabilities the rule needs, injected so callers can memoize and tests can stub. */
export interface FsProbe {
  /** Does this directory exist? Callers should memoize across sessions sharing a workspace. */
  exists(dir: string): boolean;
  /** Last-modified time (epoch ms) of a file, or null when it isn't a real on-disk file. */
  mtimeMs(path: string): number | null;
}

const HOUR_MS = 3_600_000;
const ACTIVE_MS = 60_000;

/** Compute a session's status, or null for a normal/complete session. */
export function sessionStatus(s: StatusInput, now: number, fs: FsProbe): SessionStatus | null {
  if (s.source === "vm") return null; // VM sessions carry their own lock signal
  // active = a live run: ended within the last hour AND its file changed in the last minute. The
  // hour gate avoids stat-ing the whole library — only recent sessions are probed at all.
  if (s.endedAt !== null && now - s.endedAt < HOUR_MS) {
    const m = fs.mtimeMs(s.sourcePath);
    if (m !== null && now - m < ACTIVE_MS) return "active";
  }
  if (s.interrupted) return "interrupted"; // ended on a user abort
  if (s.rounds === 0) return "empty"; // a shell with no real prompt
  if (s.workspace && !fs.exists(s.workspace)) return "orphaned"; // its cwd is gone
  return null;
}
