import { basename, join } from "node:path";
import { fork } from "./fork";
import { applyDesktopOverlay } from "./providers/claude-desktop";
import { openDb } from "./index/db";
import { indexSession, rebuildFts, searchMessages } from "./index/messages";
import { scan } from "./index/scanner";
import { builtinRegistry } from "./registry";
import { scanSkills } from "./skills/scan";
import { home } from "./util";

const DB_PATH = process.env.AGENT_SUMMA_DB ?? join(home(), ".agent-summa", "index.db");

function rel(ms: number | null): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  const m = Math.round(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function cmdScan(): void {
  const db = openDb(DB_PATH);
  const reg = builtinRegistry();
  const installed = reg.installed();
  console.log(`scanning ${installed.map((p) => p.slug).join(", ") || "(no agents detected)"} …`);
  const t0 = Date.now();
  const stats = scan(db, installed);
  const ms = Date.now() - t0;
  console.log(
    `done in ${ms}ms — total ${stats.total} · parsed ${stats.parsed} · skipped ${stats.skipped} · removed ${stats.removed} · errors ${stats.errors}`,
  );
  for (const [slug, n] of Object.entries(stats.byProvider)) console.log(`  ${slug}: ${n}`);
  const overlay = applyDesktopOverlay(db);
  console.log(`  Claude Desktop join: ${overlay.appCode} app-code · ${overlay.vmLocked} VM-locked`);
  const count = (db.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number }).n;
  console.log(`index now holds ${count} sessions → ${DB_PATH}`);
  db.close();
}

function cmdList(limit: number): void {
  const db = openDb(DB_PATH);
  const rows = db
    .prepare(
      "SELECT title, last_prompt, provider_slug, source, model_name, project_root, rounds, ended_at FROM sessions ORDER BY ended_at DESC LIMIT ?",
    )
    .all(limit) as Array<{
    title: string | null;
    last_prompt: string | null;
    provider_slug: string;
    source: string;
    model_name: string | null;
    project_root: string | null;
    rounds: number;
    ended_at: number | null;
  }>;
  for (const r of rows) {
    const proj = r.project_root ? basename(r.project_root) : "(no project)";
    const title = (r.title ?? r.last_prompt ?? "(untitled)").slice(0, 50);
    const tag = r.source === "app-code" ? "·app" : r.source === "vm" ? "·vm🔒" : "";
    console.log(
      `${rel(r.ended_at).padStart(5)}  ${(r.provider_slug + tag).padEnd(15)}  ${proj.padEnd(20)}  ${String(r.rounds).padStart(3)}⟳  ${title}`,
    );
  }
  db.close();
}

function cmdProjects(limit: number): void {
  const db = openDb(DB_PATH);
  const rows = db
    .prepare(
      "SELECT project_root, COUNT(*) n, MAX(ended_at) last FROM sessions GROUP BY project_root ORDER BY last DESC LIMIT ?",
    )
    .all(limit) as Array<{ project_root: string | null; n: number; last: number | null }>;
  for (const r of rows) {
    const name = r.project_root ? basename(r.project_root) : "(unknown)";
    console.log(`${String(r.n).padStart(4)}  ${rel(r.last).padStart(5)}  ${name}`);
  }
  db.close();
}

function cmdSkills(limit: number): void {
  const entries = scanSkills(builtinRegistry());
  for (const e of entries.slice(0, limit)) {
    const flag = e.conflict ? "  ⚠ version mismatch" : e.agents.length > 1 ? "  · shared" : "";
    console.log(`${e.agents.join(",").padEnd(30)} ${e.name}${flag}`);
  }
  const multi = entries.filter((e) => e.agents.length > 1).length;
  const conflicts = entries.filter((e) => e.conflict).length;
  console.log(`\n${entries.length} skills · ${multi} shared across agents · ${conflicts} with suspected version mismatch`);
}

function cmdReindex(limit: number): void {
  const db = openDb(DB_PATH);
  const reg = builtinRegistry();
  const rows = db
    .prepare("SELECT session_path, provider_slug FROM sessions ORDER BY ended_at DESC LIMIT ?")
    .all(limit) as Array<{ session_path: string; provider_slug: string }>;
  let total = 0;
  let done = 0;
  for (const r of rows) {
    const p = reg.bySlug(r.provider_slug);
    if (!p?.read) continue;
    try {
      total += indexSession(db, p.read(r.session_path));
      done++;
    } catch {
      /* skip unreadable */
    }
  }
  rebuildFts(db);
  console.log(`indexed ${done}/${rows.length} sessions → ${total} message rows (FTS ready)`);
  db.close();
}

function cmdSearch(query: string, limit: number): void {
  const db = openDb(DB_PATH);
  const hits = searchMessages(db, query, limit);
  for (const h of hits) {
    const proj = h.project_root ? basename(h.project_root) : "—";
    console.log(
      `[${h.provider_slug.padEnd(11)}] ${(h.title ?? "(untitled)").slice(0, 34).padEnd(34)} ${proj.padEnd(14)} ${h.snip.replace(/\s+/g, " ").slice(0, 70)}`,
    );
  }
  console.log(`\n${hits.length} hits for "${query}"`);
  db.close();
}

function cmdFork(targetSlug: string, idx: number): void {
  const db = openDb(DB_PATH);
  const rows = db
    .prepare("SELECT session_path, provider_slug, title FROM sessions ORDER BY ended_at DESC LIMIT ?")
    .all(idx + 1) as Array<{ session_path: string; provider_slug: string; title: string | null }>;
  const row = rows[idx] ?? rows[rows.length - 1];
  if (!row) {
    console.error("no sessions indexed — run scan first");
    db.close();
    return;
  }
  const outDir = process.env.FORK_OUT ?? join(home(), ".agent-summa", "forks");
  const res = fork(builtinRegistry(), row.session_path, targetSlug, outDir);
  console.log(`forked "${(row.title ?? "(untitled)").slice(0, 44)}" (${row.provider_slug}) → ${res.targetSlug}`);
  console.log(`  ${res.turns} turns → ${res.path}`);
  console.log(`  resume: ${res.resume}`);
  db.close();
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "scan";
if (cmd === "scan") cmdScan();
else if (cmd === "list") cmdList(Number(argv[1]) || 20);
else if (cmd === "projects") cmdProjects(Number(argv[1]) || 20);
else if (cmd === "skills") cmdSkills(Number(argv[1]) || 40);
else if (cmd === "reindex") cmdReindex(Number(argv[1]) || 60);
else if (cmd === "search") cmdSearch(argv[1] ?? "", Number(argv[2]) || 20);
else if (cmd === "fork") cmdFork(argv[1] ?? "codex", Number(argv[2]) || 0);
else {
  console.error(
    `unknown command: ${cmd}\nusage: scan | list [N] | projects [N] | skills [N] | reindex [N] | search <query> [N] | fork <target> [idx]`,
  );
  process.exit(1);
}
