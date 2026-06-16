import { existsSync } from "node:fs";
import type { SessionHead } from "../model";
import type { Provider } from "../provider";
import { statFile } from "../util";
import type { DB } from "./db";

export interface ScanStats {
  total: number;
  parsed: number;
  skipped: number;
  removed: number;
  errors: number;
  byProvider: Record<string, number>;
}

interface ScanStateRow {
  file_modified: number;
  file_size: number;
  last_parse_status: string;
}

export function scan(db: DB, providers: Provider[]): ScanStats {
  const stats: ScanStats = { total: 0, parsed: 0, skipped: 0, removed: 0, errors: 0, byProvider: {} };

  const getState = db.prepare<[string], ScanStateRow>(
    "SELECT file_modified, file_size, last_parse_status FROM scan_state WHERE session_path = ?",
  );
  const upsertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions
      (session_path, session_id, provider_slug, source, workspace, project_root,
       title, title_source, last_prompt, summary, model_name, rounds, message_count,
       started_at, ended_at, input_tokens, output_tokens, cli_session_id, metadata_json, indexed_at)
    VALUES
      (@sessionPath, @sessionId, @providerSlug, @source, @workspace, @projectRoot,
       @title, @titleSource, @lastPrompt, @summary, @modelName, @rounds, @messageCount,
       @startedAt, @endedAt, @inputTokens, @outputTokens, @cliSessionId, @metadataJson, @indexedAt)
  `);
  const upsertState = db.prepare(`
    INSERT INTO scan_state
      (session_path, backing_path, provider_slug, file_modified, file_size,
       last_scanned_at, last_parse_status, read_offset, append_trust_count)
    VALUES (@sessionPath, @backingPath, @providerSlug, @fileModified, @fileSize,
            @lastScannedAt, @lastParseStatus, @readOffset, @appendTrustCount)
    ON CONFLICT(session_path) DO UPDATE SET
      file_modified=@fileModified, file_size=@fileSize, last_scanned_at=@lastScannedAt,
      last_parse_status=@lastParseStatus
  `);
  const delSession = db.prepare("DELETE FROM sessions WHERE session_path = ?");
  const delState = db.prepare("DELETE FROM scan_state WHERE session_path = ?");
  const allState = db.prepare<[], { session_path: string; backing_path: string }>(
    "SELECT session_path, backing_path FROM scan_state",
  );

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const toSessionRow = (h: SessionHead) => ({
    sessionPath: h.sourcePath,
    sessionId: h.sessionId,
    providerSlug: h.providerSlug,
    source: h.source,
    workspace: h.workspace ?? null,
    projectRoot: h.projectRoot ?? null,
    title: h.title ?? null,
    titleSource: h.titleSource,
    lastPrompt: h.lastPrompt ?? null,
    summary: h.summary ?? null,
    modelName: h.modelName ?? null,
    rounds: h.rounds,
    messageCount: h.messageCount,
    startedAt: h.startedAt ?? null,
    endedAt: h.endedAt ?? null,
    inputTokens: h.usage?.inputTokens ?? null,
    outputTokens: h.usage?.outputTokens ?? null,
    cliSessionId: (h.metadata?.cliSessionId as string | undefined) ?? null,
    metadataJson: JSON.stringify(h.metadata ?? {}),
    indexedAt: nowIso,
  });

  const run = db.transaction((provider: Provider) => {
    for (const path of provider.list()) {
      stats.total++;
      const st = statFile(path);
      if (!st) continue;
      const prev = getState.get(path);
      if (prev && prev.file_modified === st.mtime && prev.file_size === st.size && prev.last_parse_status === "ok") {
        stats.skipped++;
        continue;
      }
      try {
        const head = provider.readHead(path);
        upsertSession.run(toSessionRow(head));
        upsertState.run({
          sessionPath: head.sourcePath,
          backingPath: head.backingPath,
          providerSlug: provider.slug,
          fileModified: st.mtime,
          fileSize: st.size,
          lastScannedAt: now,
          lastParseStatus: "ok",
          readOffset: st.size,
          appendTrustCount: 3,
        });
        stats.parsed++;
        stats.byProvider[provider.slug] = (stats.byProvider[provider.slug] ?? 0) + 1;
      } catch {
        stats.errors++;
        upsertState.run({
          sessionPath: path,
          backingPath: path,
          providerSlug: provider.slug,
          fileModified: st.mtime,
          fileSize: st.size,
          lastScannedAt: now,
          lastParseStatus: "error",
          readOffset: 0,
          appendTrustCount: 0,
        });
      }
    }
  });

  for (const provider of providers) run(provider);

  // Reconcile removals: drop rows whose backing file no longer exists on disk.
  const reconcile = db.transaction(() => {
    for (const row of allState.all()) {
      if (!existsSync(row.backing_path)) {
        delSession.run(row.session_path);
        delState.run(row.session_path);
        stats.removed++;
      }
    }
  });
  reconcile();

  return stats;
}
