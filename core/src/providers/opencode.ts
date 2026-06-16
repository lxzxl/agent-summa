import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { DB } from "../index/db";
import type { CanonicalMessage, CanonicalSession, MessageRole, SessionHead, ToolCall } from "../model";
import type { DetectionResult, Provider, ResumeCommand } from "../provider";
import { gitRoot, home } from "../util";

type OcDb = InstanceType<typeof Database>;
const PREFIX = "opencode:";

function opencodeDbPath(): string {
  return join(home(), ".local", "share", "opencode", "opencode.db");
}

/** Open opencode's store read-only (WAL allows reads even while opencode runs). */
function openRO(): OcDb | undefined {
  const p = opencodeDbPath();
  if (!existsSync(p)) return undefined;
  try {
    return new Database(p, { readonly: true, fileMustExist: true });
  } catch {
    return undefined;
  }
}

/** `session.model` is JSON like {"id":"deepseek-v4-flash","providerID":"deepseek"}. */
function modelName(model: string | null): string | undefined {
  if (!model) return undefined;
  try {
    const m = JSON.parse(model) as { id?: string; modelID?: string };
    return m.id ?? m.modelID ?? undefined;
  } catch {
    return model || undefined;
  }
}

interface OcSession {
  id: string;
  title: string;
  directory: string;
  model: string | null;
  agent: string | null;
  time_created: number;
  time_updated: number;
  tokens_input: number;
  tokens_output: number;
  parent_id: string | null;
}

const SESSION_COLS =
  "id, title, directory, model, agent, time_created, time_updated, tokens_input, tokens_output, parent_id";

function headFromRow(r: OcSession, messageCount: number, rounds: number): SessionHead {
  const tok = r.tokens_input || r.tokens_output;
  return {
    sessionId: r.id,
    providerSlug: "opencode",
    source: "db-backed",
    title: r.title || undefined,
    titleSource: r.title ? "ai" : "none",
    workspace: r.directory || undefined,
    projectRoot: gitRoot(r.directory || undefined),
    modelName: modelName(r.model),
    rounds,
    messageCount,
    startedAt: r.time_created || undefined,
    endedAt: r.time_updated || undefined,
    usage: tok
      ? {
          inputTokens: r.tokens_input,
          outputTokens: r.tokens_output,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        }
      : undefined,
    sourcePath: PREFIX + r.id,
    backingPath: opencodeDbPath(),
    metadata: r.parent_id ? { parentId: r.parent_id } : undefined,
  };
}

function idOf(path: string): string {
  return path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
}

export class OpencodeProvider implements Provider {
  readonly name = "OpenCode";
  readonly slug = "opencode";
  readonly cliAlias = "opencode";

  detect(): DetectionResult {
    const p = opencodeDbPath();
    const installed = existsSync(p);
    return { installed, evidence: installed ? [p] : [] };
  }

  sessionRoots(): string[] {
    return [opencodeDbPath()];
  }

  skillsDir(): string | undefined {
    return undefined; // opencode skills support is uncertain — don't make it a distribution target
  }

  // Sessions live in a SQLite db, not files; the logical path is `opencode:<id>`.
  ownsPath(path: string): boolean {
    return path.startsWith(PREFIX);
  }

  list(): string[] {
    const db = openRO();
    if (!db) return [];
    try {
      const rows = db.prepare("SELECT id FROM session ORDER BY time_updated DESC").all() as { id: string }[];
      return rows.map((r) => PREFIX + r.id);
    } finally {
      db.close();
    }
  }

  readHead(path: string): SessionHead {
    const db = openRO();
    if (!db) throw new Error("opencode.db not found");
    try {
      return readHeadOn(db, idOf(path));
    } finally {
      db.close();
    }
  }

  read(path: string): CanonicalSession {
    const id = idOf(path);
    const db = openRO();
    if (!db) throw new Error("opencode.db not found");
    try {
      const head = readHeadOn(db, id);
      const msgs = db
        .prepare("SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created")
        .all(id) as { id: string; data: string; time_created: number }[];
      const partsOf = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created");
      const messages: CanonicalMessage[] = [];
      let idx = 0;
      for (const m of msgs) {
        let role: MessageRole = "assistant";
        try {
          const md = JSON.parse(m.data) as { role?: string };
          role = md.role === "user" ? "user" : md.role === "assistant" ? "assistant" : "system";
        } catch {
          /* keep default */
        }
        let text = "";
        const toolCalls: ToolCall[] = [];
        for (const p of partsOf.all(m.id) as { data: string }[]) {
          let pd: Record<string, unknown>;
          try {
            pd = JSON.parse(p.data) as Record<string, unknown>;
          } catch {
            continue;
          }
          // synthetic text = editor-context injection (not real conversation); step-*/reasoning = structural
          if (pd.type === "text" && typeof pd.text === "string" && !pd.synthetic) text += pd.text;
          else if (pd.type === "tool" && typeof pd.tool === "string") {
            const state = pd.state as { input?: unknown } | undefined;
            toolCalls.push({ name: pd.tool, arguments: state?.input ?? pd.input ?? {} });
          }
        }
        if (!text && toolCalls.length === 0) continue;
        messages.push({
          idx: idx++,
          role,
          content: text,
          timestamp: m.time_created || undefined,
          isSidechain: false,
          toolCalls,
          toolResults: [],
        });
      }
      return { ...head, messages, messageCount: messages.length };
    } finally {
      db.close();
    }
  }

  resumeCmd(sessionId: string, _logicalPath: string, workspace?: string): ResumeCommand {
    return { program: "opencode", args: ["--session", idOf(sessionId)], cwd: workspace };
  }
}

function readHeadOn(db: OcDb, id: string): SessionHead {
  const r = db.prepare(`SELECT ${SESSION_COLS} FROM session WHERE id = ?`).get(id) as OcSession | undefined;
  if (!r) throw new Error(`opencode session ${id} not found`);
  const mc = (db.prepare("SELECT COUNT(*) n FROM message WHERE session_id = ?").get(id) as { n: number }).n;
  const uc = (
    db.prepare("SELECT COUNT(*) n FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user'").get(id) as {
      n: number;
    }
  ).n;
  return headFromRow(r, mc, uc);
}

/**
 * Index every opencode session into the cross-agent index. opencode is db-backed (no per-session
 * file), so the file scanner can't reach it — we mirror the claude-desktop overlay: clear + reinsert.
 */
export function applyOpencodeOverlay(db: DB): { sessions: number } {
  const oc = openRO();
  if (!oc) return { sessions: 0 };
  const nowIso = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO sessions
      (session_path, session_id, provider_slug, source, workspace, project_root, title, title_source,
       last_prompt, summary, model_name, rounds, message_count, started_at, ended_at,
       input_tokens, output_tokens, cli_session_id, metadata_json, indexed_at)
    VALUES (@sessionPath, @sessionId, 'opencode', 'db-backed', @workspace, @projectRoot, @title, @titleSource,
       NULL, NULL, @model, @rounds, @messageCount, @startedAt, @endedAt,
       @inputTokens, @outputTokens, NULL, @metadataJson, @indexedAt)
  `);
  const clear = db.prepare("DELETE FROM sessions WHERE provider_slug = 'opencode'");
  let sessions = 0;
  try {
    const rows = oc.prepare(`SELECT ${SESSION_COLS} FROM session`).all() as OcSession[];
    const mc = oc.prepare("SELECT COUNT(*) n FROM message WHERE session_id = ?");
    const uc = oc.prepare("SELECT COUNT(*) n FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user'");
    const tx = db.transaction(() => {
      clear.run();
      for (const r of rows) {
        const h = headFromRow(r, (mc.get(r.id) as { n: number }).n, (uc.get(r.id) as { n: number }).n);
        upsert.run({
          sessionPath: h.sourcePath,
          sessionId: h.sessionId,
          workspace: h.workspace ?? null,
          projectRoot: h.projectRoot ?? null,
          title: h.title ?? null,
          titleSource: h.titleSource,
          model: h.modelName ?? null,
          rounds: h.rounds,
          messageCount: h.messageCount,
          startedAt: h.startedAt ?? null,
          endedAt: h.endedAt ?? null,
          inputTokens: h.usage?.inputTokens ?? null,
          outputTokens: h.usage?.outputTokens ?? null,
          metadataJson: JSON.stringify(h.metadata ?? {}),
          indexedAt: nowIso,
        });
        sessions++;
      }
    });
    tx();
  } finally {
    oc.close();
  }
  return { sessions };
}
