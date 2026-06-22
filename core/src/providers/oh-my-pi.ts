import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  flattenContent,
  normalizeRole,
  parseTimestamp,
  truncateTitle,
  type CanonicalMessage,
  type CanonicalSession,
  type MessageRole,
  type SessionHead,
  type TitleSource,
  type ToolCall,
} from "../model";
import type { DetectionResult, Provider, ResumeCommand } from "../provider";
import { gitRoot, home, readAllRecords, walkFiles } from "../util";

// oh-my-pi (CLI `omp`; formerly "pi") stores each session as append-only JSONL: line 1 is a
// `type:"session"` header, the rest are tree entries (`message` / `model_change` / …) linked by
// id/parentId. Two homes coexist — the current ~/.omp/agent and the legacy ~/.pi/agent (older
// `--abs--` dir encoding) — but the on-disk shape is identical, so one provider reads both.
//
// Message roles: user / assistant carry text + `toolCall` content blocks; tool output arrives as a
// separate `toolResult` message (role:"toolResult") with `toolCallId` + `toolName` + content blocks.

/** Current omp agent dir, honoring the same env overrides omp itself uses. */
function ompAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  const cfg = process.env.PI_CONFIG_DIR || join(home(), ".omp");
  return join(cfg, "agent");
}

// Top-level session files are `<timestamp>_<sessionId>.jsonl`. Subagent transcripts
// (`<AgentId>.jsonl`) and bash logs sit one level deeper inside a `<timestamp>_<id>/`
// sidecar dir; the timestamp prefix keeps the walk from listing those as sessions.
const SESSION_RE = /^\d{4}-\d{2}-\d{2}T[\dZ.-]+_[0-9a-fA-F-]{8,}\.jsonl$/;

/** Count subagent transcripts in a session's sidecar dir (path minus `.jsonl`); 0 when none. */
function countSubagents(sessionPath: string): number {
  const dir = sessionPath.replace(/\.jsonl$/, "");
  if (!existsSync(dir)) return 0;
  return walkFiles(dir, (n) => n.endsWith(".jsonl")).length;
}

/** Visible text of an omp message: only `text` blocks count (thinking / toolCall are not content). */
function ompText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return flattenContent(content);
  let out = "";
  for (const b of content) {
    if (b != null && typeof b === "object" && "type" in b && b.type === "text" && "text" in b && typeof b.text === "string") {
      out += b.text;
    }
  }
  return out;
}

/** A `model_change` carries either `model:"provider/id"` (current) or `provider`+`modelId` (legacy pi). */
function modelFrom(o: Record<string, any>): string | undefined {
  if (typeof o.model === "string") return o.model;
  if (typeof o.modelId === "string") return typeof o.provider === "string" ? `${o.provider}/${o.modelId}` : o.modelId;
  return undefined;
}

const INTERRUPT_PREFIX = "[Request interrupted";

export class OhMyPiProvider implements Provider {
  readonly name = "oh-my-pi";
  readonly slug = "oh-my-pi";
  readonly cliAlias = "omp";

  detect(): DetectionResult {
    const roots = this.sessionRoots().filter((r) => existsSync(r));
    return { installed: roots.length > 0, evidence: roots };
  }

  sessionRoots(): string[] {
    // Current home, then the pre-rename ~/.pi home (same format) so old sessions stay visible.
    return [join(ompAgentDir(), "sessions"), join(home(), ".pi", "agent", "sessions")];
  }

  skillsDir(): string | undefined {
    // Prefer whichever home actually holds skills (so the matrix shows the user's real ones);
    // fall back to the current omp location when neither exists yet.
    const current = join(ompAgentDir(), "skills");
    if (existsSync(current)) return current;
    const legacy = join(home(), ".pi", "agent", "skills");
    if (existsSync(legacy)) return legacy;
    return current;
  }

  ownsPath(path: string): boolean {
    return path.endsWith(".jsonl") && this.sessionRoots().some((r) => path === r || path.startsWith(`${r}/`));
  }

  list(): string[] {
    return this.sessionRoots().flatMap((root) => walkFiles(root, (n) => SESSION_RE.test(n)));
  }

  readHead(path: string): SessionHead {
    const recs = readAllRecords(path);
    const header = (recs.find((r) => r != null && typeof r === "object" && "type" in r && r.type === "session") ??
      {}) as Record<string, any>;

    const cwd: string | undefined = typeof header.cwd === "string" ? header.cwd : undefined;
    let model: string | undefined;
    let firstUserText: string | undefined;
    let lastUserText: string | undefined;
    let rounds = 0;
    let messageCount = 0;
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    let interrupted = false;

    const headerTs = parseTimestamp(header.timestamp);
    if (headerTs !== undefined) {
      minTs = headerTs;
      maxTs = headerTs;
    }

    for (const r of recs) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, any>;
      const ts = parseTimestamp(o.timestamp);
      if (ts !== undefined) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
      if (o.type === "model_change") {
        if (!model) model = modelFrom(o);
        continue;
      }
      if (o.type !== "message" || !o.message || typeof o.message !== "object") continue;
      const msg = o.message as Record<string, any>;
      if (msg.role === "user") {
        messageCount++;
        // omp keeps tool output in its own `toolResult` messages, so every user message with text
        // is a real human turn — no tool-result-as-user filtering needed (unlike Claude Code).
        const text = ompText(msg.content);
        if (text.startsWith(INTERRUPT_PREFIX)) {
          interrupted = true;
        } else if (text.trim()) {
          interrupted = false;
          rounds++;
          if (firstUserText === undefined) firstUserText = text;
          lastUserText = text;
        }
      } else if (msg.role === "assistant") {
        messageCount++;
        interrupted = false;
        if (!model && typeof msg.model === "string") model = typeof msg.provider === "string" ? `${msg.provider}/${msg.model}` : msg.model;
      } else if (msg.role === "toolResult") {
        messageCount++;
      }
    }

    let title: string | undefined;
    let titleSource: TitleSource = "none";
    if (typeof header.title === "string" && header.title) {
      title = header.title;
      titleSource = header.titleSource === "custom" ? "custom" : "ai";
    } else if (firstUserText) {
      title = truncateTitle(firstUserText);
      titleSource = "prompt";
    }

    const sessionId =
      typeof header.id === "string" && header.id ? header.id : basename(path, ".jsonl").replace(/^[^_]*_/, "");

    const meta: Record<string, unknown> = {};
    if (interrupted) meta.interrupted = true;
    const subs = countSubagents(path);
    if (subs) meta.subagents = subs;

    return {
      sessionId,
      providerSlug: this.slug,
      source: "cli",
      title,
      titleSource,
      lastPrompt: lastUserText ? truncateTitle(lastUserText, 120) : undefined,
      workspace: cwd,
      projectRoot: gitRoot(cwd),
      modelName: model,
      rounds,
      messageCount,
      startedAt: Number.isFinite(minTs) ? minTs : undefined,
      endedAt: Number.isFinite(maxTs) ? maxTs : undefined,
      sourcePath: path,
      backingPath: path,
      metadata: Object.keys(meta).length ? meta : undefined,
    };
  }

  read(path: string): CanonicalSession {
    const head = this.readHead(path);
    const recs = readAllRecords(path);
    const messages: CanonicalMessage[] = [];
    let idx = 0;
    for (const r of recs) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, any>;
      if (o.type !== "message" || !o.message || typeof o.message !== "object") continue;
      const msg = o.message as Record<string, any>;
      const ts = parseTimestamp(o.timestamp);
      const nativeId = typeof o.id === "string" ? o.id : undefined;
      const parentId = typeof o.parentId === "string" ? o.parentId : undefined;
      const content = ompText(msg.content);

      // Tool output: a `toolResult` message paired to its call via toolCallId → a `tool` turn.
      if (msg.role === "toolResult") {
        const callId = typeof msg.toolCallId === "string" ? msg.toolCallId : undefined;
        messages.push({
          idx: idx++,
          role: "tool",
          content,
          timestamp: ts,
          nativeId,
          parentId,
          isSidechain: false,
          toolCalls: [],
          toolResults: [{ callId, content, isError: msg.isError === true }],
        });
        continue;
      }

      const toolCalls: ToolCall[] = [];
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b && typeof b === "object" && b.type === "toolCall") {
            toolCalls.push({
              id: b.id,
              name: (typeof b.name === "string" ? b.name : b.toolName) ?? "tool",
              arguments: b.arguments ?? b.input,
            });
          }
        }
      }
      if (!content && toolCalls.length === 0) continue;
      const role: MessageRole = normalizeRole(typeof msg.role === "string" ? msg.role : "other");
      messages.push({ idx: idx++, role, content, timestamp: ts, nativeId, parentId, isSidechain: false, toolCalls, toolResults: [] });
    }
    // Branches/compaction can break id/parentId order; chronological is the intuitive transcript.
    messages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    messages.forEach((m, i) => {
      m.idx = i;
    });
    return { ...head, messages, messageCount: messages.length };
  }

  resumeCmd(sessionId: string, _logicalPath: string, workspace?: string): ResumeCommand {
    return { program: "omp", args: ["--resume", sessionId], cwd: workspace };
  }
}
