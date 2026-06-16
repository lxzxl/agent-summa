import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DB } from "../index/db";
import { gitRoot, home, walkFiles } from "../util";

/** Claude Desktop's Cowork session catalog: ~/Library/Application Support/Claude/claude-code-sessions/<dev>/<acct>/local_*.json */
function desktopRoot(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home(), "AppData", "Roaming");
    return join(appData, "Claude", "claude-code-sessions");
  }
  return join(home(), "Library", "Application Support", "Claude", "claude-code-sessions");
}

export interface DesktopEntry {
  localId: string;
  cliSessionId?: string;
  cwd?: string;
  title?: string;
  model?: string;
  isArchived: boolean;
  createdAt?: number;
  lastActivityAt?: number;
  completedTurns?: number;
}

export function readDesktopCatalog(): DesktopEntry[] {
  const root = desktopRoot();
  if (!existsSync(root)) return [];
  const out: DesktopEntry[] = [];
  for (const f of walkFiles(root, (n) => n.startsWith("local_") && n.endsWith(".json"))) {
    try {
      const o = JSON.parse(readFileSync(f, "utf8")) as Record<string, any>;
      out.push({
        localId: typeof o.sessionId === "string" ? o.sessionId : basename(f, ".json"),
        cliSessionId: typeof o.cliSessionId === "string" ? o.cliSessionId : undefined,
        cwd: o.cwd ?? o.originCwd,
        title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : undefined,
        model: typeof o.model === "string" ? o.model : undefined,
        isArchived: !!o.isArchived,
        createdAt: typeof o.createdAt === "number" ? o.createdAt : undefined,
        lastActivityAt: typeof o.lastActivityAt === "number" ? o.lastActivityAt : undefined,
        completedTurns: typeof o.completedTurns === "number" ? o.completedTurns : undefined,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/**
 * Overlay the Claude Desktop catalog onto the indexed sessions (the catalog-join pass):
 * - matched by cliSessionId → mark `source='app-code'`, prefer the desktop-assigned title;
 * - unmatched (transcript lives in the VM image, not on the host) → insert a `source='vm'` locked row.
 * Idempotent; run after `scan()`. VM rows are fully rebuilt each pass (no scan_state, so the scanner's
 * reconcile never touches them).
 */
export function applyDesktopOverlay(db: DB): { appCode: number; vmLocked: number } {
  const catalog = readDesktopCatalog();
  const find = db.prepare("SELECT session_path FROM sessions WHERE session_id = ? AND provider_slug = 'claude-code'");
  const update = db.prepare(`
    UPDATE sessions SET
      source = 'app-code',
      title = COALESCE(NULLIF(@title, ''), title),
      title_source = CASE WHEN @title <> '' THEN 'custom' ELSE title_source END,
      model_name = COALESCE(@model, model_name),
      cli_session_id = @localId
    WHERE session_path = @sessionPath
  `);
  const insertVm = db.prepare(`
    INSERT OR REPLACE INTO sessions
      (session_path, session_id, provider_slug, source, workspace, project_root, title, title_source,
       last_prompt, summary, model_name, rounds, message_count, started_at, ended_at,
       input_tokens, output_tokens, cli_session_id, metadata_json, indexed_at)
    VALUES (@sessionPath, @sessionId, 'claude-code', 'vm', @workspace, @projectRoot, @title, 'custom',
       NULL, NULL, @model, @rounds, @rounds, @startedAt, @endedAt, NULL, NULL, @localId,
       '{"vmLocked":true}', @indexedAt)
  `);
  const clearVm = db.prepare("DELETE FROM sessions WHERE source = 'vm'");

  let appCode = 0;
  let vmLocked = 0;
  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    clearVm.run();
    for (const e of catalog) {
      if (!e.cliSessionId) continue;
      const row = find.get(e.cliSessionId) as { session_path: string } | undefined;
      if (row) {
        update.run({ sessionPath: row.session_path, title: e.title ?? "", model: e.model ?? null, localId: e.localId });
        appCode++;
      } else {
        insertVm.run({
          sessionPath: `claude-desktop-vm:${e.cliSessionId}`,
          sessionId: e.cliSessionId,
          workspace: e.cwd ?? null,
          projectRoot: gitRoot(e.cwd) ?? null,
          title: e.title ?? "(VM session)",
          model: e.model ?? null,
          rounds: e.completedTurns ?? 0,
          startedAt: e.createdAt ?? null,
          endedAt: e.lastActivityAt ?? null,
          localId: e.localId,
          indexedAt: nowIso,
        });
        vmLocked++;
      }
    }
  });
  tx();
  return { appCode, vmLocked };
}
