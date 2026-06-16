// Off-main FTS indexer — runs as an Electron utilityProcess so message-content indexing (full file
// reads + synchronous better-sqlite3 writes) never blocks the main process or the UI. It owns its own
// DB connection (WAL allows the main process to keep reading), and reports progress to the parent.
//
// Incremental: each session is marked `fts_indexed=1` once processed (even if it yields 0 rows), so
// it's never re-read; empty (rounds=0) sessions are skipped outright. Runs fully synchronously here
// because blocking *this* process is fine — that's the whole point of moving it off-main.
import { statSync } from "node:fs";
import { builtinRegistry, indexSession, openDb, rebuildFts } from "@agent-summa/core";
import type { FtsProgress } from "@shared/ipc";

const MAX_FTS_BYTES = 64 * 1024 * 1024; // skip the read for pathologically large sessions
const dbPath = process.argv[2];
const appVersion = process.argv[3] || "0.0.0";

const post = (msg: FtsProgress): void => {
  process.parentPort?.postMessage(msg);
};

function run(): void {
  const db = openDb(dbPath, appVersion);
  const reg = builtinRegistry();
  // One-time: sessions already in the FTS table are done (covers DBs indexed before the column existed).
  db.prepare(
    "UPDATE sessions SET fts_indexed = 1 WHERE fts_indexed IS NULL AND session_path IN (SELECT DISTINCT session_path FROM message_entries)",
  ).run();
  const markDone = db.prepare("UPDATE sessions SET fts_indexed = 1 WHERE session_path = ?");
  const rows = db
    .prepare("SELECT session_path, provider_slug FROM sessions WHERE source != 'vm' AND rounds > 0 AND fts_indexed IS NULL")
    .all() as { session_path: string; provider_slug: string }[];
  const total = rows.length;
  if (total === 0) {
    post({ type: "done", indexed: 0, total: 0 });
    return;
  }
  post({ type: "start", total });
  let indexed = 0;
  let done = 0;
  let dirty = false;
  for (const r of rows) {
    const p = reg.bySlug(r.provider_slug);
    let tooBig = false;
    try {
      tooBig = statSync(r.session_path).size > MAX_FTS_BYTES;
    } catch {
      /* db-backed synthetic path (e.g. opencode:<id>) — no file to stat, proceed */
    }
    if (p?.read && !tooBig) {
      try {
        indexSession(db, p.read(r.session_path));
        dirty = true;
        indexed++;
      } catch {
        /* unreadable / parse error — still marked done so it isn't retried every launch */
      }
    }
    markDone.run(r.session_path);
    done++;
    if (indexed > 0 && indexed % 40 === 0) rebuildFts(db); // make search progressively usable
    if (done % 5 === 0 || done === total) post({ type: "progress", done, total });
  }
  if (dirty) rebuildFts(db);
  db.close();
  post({ type: "done", indexed, total });
}

try {
  run();
} catch (e) {
  post({ type: "error", message: String(e) });
}
