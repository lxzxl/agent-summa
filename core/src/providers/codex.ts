import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  flattenContent,
  parseTimestamp,
  truncateTitle,
  type CanonicalMessage,
  type CanonicalSession,
  type MessageRole,
  type SessionHead,
  type TitleSource,
} from "../model";
import type { DetectionResult, Provider, ResumeCommand } from "../provider";
import { gitRoot, home, readAllRecords, walkFiles } from "../util";

function codexRoot(): string {
  return process.env.CODEX_HOME ?? join(home(), ".codex");
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const isRollout = (name: string): boolean => name.startsWith("rollout-") && name.endsWith(".jsonl");

/** Injected context (AGENTS.md, <user_action>/<environment_context>, etc.) — not a real user prompt. */
function isInjected(text: string): boolean {
  const s = text.trimStart();
  return (
    s.startsWith("<") ||
    s.startsWith("#") ||
    /^instructions\b/i.test(s) ||
    s.includes("instructions for /")
  );
}

/** Codex CLI/IDE injects the workspace path inside an <environment_context> block. */
const CWD_RE = /<cwd>\s*([^<\n]+?)\s*<\/cwd>/;
/** The Codex IDE wraps each turn as "# Context from my IDE setup: … ## My request for Codex:\n<prompt>". */
const IDE_REQUEST_MARKER = "## My request for Codex:";

/**
 * Recover the actual human prompt from a Codex user message. IDE sessions bury the
 * real text after IDE-context noise behind a "## My request for Codex:" marker; CLI
 * sessions send it verbatim. Returns undefined for pure injected context
 * (AGENTS.md / <environment_context> / IDE setup with no request).
 */
function realUserPrompt(text: string): string | undefined {
  const i = text.indexOf(IDE_REQUEST_MARKER);
  if (i >= 0) {
    const req = text.slice(i + IDE_REQUEST_MARKER.length).trim();
    return req || undefined;
  }
  return isInjected(text) ? undefined : text;
}

/** Concatenate Codex message content blocks (input_text / output_text) to plain text. */
function codexText(content: unknown): string {
  if (!Array.isArray(content)) return flattenContent(content);
  return content
    .map((b) => {
      if (b && typeof b === "object") {
        const o = b as Record<string, unknown>;
        if ((o.type === "input_text" || o.type === "output_text" || o.type === "text") && typeof o.text === "string") {
          return o.text;
        }
      }
      return "";
    })
    .join("");
}

export class CodexProvider implements Provider {
  readonly name = "Codex";
  readonly slug = "codex";
  readonly cliAlias = "codex";

  detect(): DetectionResult {
    const installed = existsSync(join(codexRoot(), "sessions"));
    return { installed, evidence: installed ? [join(codexRoot(), "sessions")] : [] };
  }

  sessionRoots(): string[] {
    return [join(codexRoot(), "sessions"), join(codexRoot(), "archived_sessions")];
  }

  skillsDir(): string | undefined {
    return join(codexRoot(), "skills");
  }

  ownsPath(path: string): boolean {
    return path.includes(`${join(".codex", "")}`) && isRollout(basename(path));
  }

  list(): string[] {
    return this.sessionRoots().flatMap((root) => walkFiles(root, isRollout));
  }

  readHead(path: string): SessionHead {
    // Full scan (not head/tail window): rounds and the first/last real prompt can sit
    // past a 64 KB window behind huge injected preambles. Codex sessions total ~150 MB
    // on disk here and parse in well under a second, so accuracy wins over a cheap read.
    const recs = readAllRecords(path);
    let sessionId: string | undefined;
    let cwd: string | undefined;
    let model: string | undefined;
    let firstUserText: string | undefined;
    let lastUserText: string | undefined;
    let rounds = 0;
    let messageCount = 0;
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    let interrupted = false;

    for (const r of recs) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, any>;
      const ts = parseTimestamp(o.timestamp);
      if (ts !== undefined) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
      const pm = o.payload?.model ?? o.model ?? o.payload?.turn_context?.model;
      if (!model && typeof pm === "string") model = pm;
      if (o.type === "session_meta") {
        const p = o.payload ?? o;
        if (typeof p.id === "string") sessionId = p.id;
        if (typeof p.cwd === "string") cwd = p.cwd;
        if (typeof p.model === "string") model = p.model;
        continue;
      }
      // Messages arrive either wrapped (response_item.payload — current format) or
      // bare at the record root (legacy 2025-09 format, which has no session_meta).
      const msg =
        o.type === "response_item" && o.payload?.type === "message"
          ? (o.payload as Record<string, any>)
          : o.type === "message"
            ? o
            : undefined;
      if (msg && typeof msg.role === "string") {
        const text = codexText(msg.content);
        if (text) {
          messageCount++;
          if (msg.role === "user") {
            if (text.includes("<turn_aborted>")) {
              interrupted = true; // user aborted the turn
            } else {
              // Legacy sessions carry the cwd only inside an <environment_context> block.
              if (!cwd) {
                const found = CWD_RE.exec(text)?.[1]?.trim();
                if (found) cwd = found;
              }
              const real = realUserPrompt(text);
              if (real) {
                interrupted = false;
                rounds++;
                lastUserText = real;
                if (firstUserText === undefined) firstUserText = real;
              }
            }
          } else if (msg.role === "assistant") {
            interrupted = false; // agent replied after → session didn't end on an abort
          }
        }
      }
    }

    if (!sessionId) sessionId = UUID_RE.exec(basename(path))?.[0] ?? basename(path, ".jsonl");

    let title: string | undefined;
    let titleSource: TitleSource = "none";
    if (firstUserText) {
      title = truncateTitle(firstUserText);
      titleSource = "prompt";
    }

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
      metadata: interrupted ? { interrupted: true } : undefined,
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
      // Current format wraps items in response_item; legacy 2025-09 puts them bare at root.
      const p = o.type === "response_item" ? (o.payload ?? {}) : o.type === "message" ? o : undefined;
      if (!p) continue;
      const ts = parseTimestamp(o.timestamp);
      if (p.type === "message" && typeof p.role === "string") {
        const raw = codexText(p.content);
        if (!raw) continue;
        const role: MessageRole = p.role === "user" ? "user" : p.role === "assistant" ? "assistant" : "system";
        // Drop pure injected user turns (AGENTS.md / <environment_context>) and unwrap the
        // IDE envelope, so the transcript shows what you actually typed, not the context dump.
        let content = raw;
        if (role === "user") {
          const real = realUserPrompt(raw);
          if (!real) continue;
          content = real;
        }
        messages.push({ idx: idx++, role, content, timestamp: ts, isSidechain: false, toolCalls: [], toolResults: [] });
      } else if (p.type === "function_call" || p.type === "custom_tool_call") {
        let args: unknown = p.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            /* keep raw string */
          }
        }
        messages.push({
          idx: idx++,
          role: "assistant",
          content: "",
          timestamp: ts,
          isSidechain: false,
          toolCalls: [{ id: p.call_id, name: p.name, arguments: args }],
          toolResults: [],
        });
      } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
        const out = typeof p.output === "string" ? p.output : flattenContent(p.output);
        messages.push({
          idx: idx++,
          role: "tool",
          content: out,
          timestamp: ts,
          isSidechain: false,
          toolCalls: [],
          toolResults: [{ callId: p.call_id, content: out, isError: false }],
        });
      }
    }
    return { ...head, messages, messageCount: messages.length };
  }

  resumeCmd(sessionId: string, _logicalPath: string, workspace?: string): ResumeCommand {
    return { program: "codex", args: ["resume", sessionId], cwd: workspace };
  }
}
