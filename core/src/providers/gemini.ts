import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  flattenContent,
  normalizeRole,
  parseTimestamp,
  truncateTitle,
  type CanonicalMessage,
  type CanonicalSession,
  type SessionHead,
  type TitleSource,
  type ToolCall,
  type ToolResult,
} from "../model";
import type { DetectionResult, Provider, ResumeCommand } from "../provider";
import { home, walkFiles } from "../util";

/**
 * Gemini CLI and its fork Qwen Code store conversations as JSONL (first line = metadata,
 * then one MessageRecord per line) or as a single JSON ConversationRecord with a `messages[]`.
 * This reader handles both. NOTE: workspace is not recoverable (projectHash is one-way) → sessions
 * group under "(unknown)". Unverified locally (this machine has no Gemini/Qwen chat sessions).
 */
class GeminiLikeProvider implements Provider {
  constructor(
    readonly name: string,
    readonly slug: string,
    readonly cliAlias: string,
    private readonly rootDir: string,
    private readonly program: string,
  ) {}

  detect(): DetectionResult {
    const installed = existsSync(this.rootDir);
    return { installed, evidence: installed ? [this.rootDir] : [] };
  }

  sessionRoots(): string[] {
    return [this.rootDir];
  }

  skillsDir(): string | undefined {
    return join(this.rootDir, "..", "commands");
  }

  ownsPath(path: string): boolean {
    return path.includes(`${this.slug === "qwen" ? ".qwen" : ".gemini"}`) && path.includes("chats") && path.endsWith(".jsonl");
  }

  list(): string[] {
    return walkFiles(this.rootDir, (n) => n.endsWith(".jsonl")).filter((p) => p.includes("chats"));
  }

  /** Parse either a single-doc ConversationRecord (`.messages[]`) or JSONL (line0 meta + records). */
  private parse(path: string): { meta: Record<string, any>; msgs: any[] } {
    const text = readFileSync(path, "utf8");
    try {
      const doc = JSON.parse(text);
      if (doc && Array.isArray(doc.messages)) return { meta: doc, msgs: doc.messages };
    } catch {
      /* fall through to JSONL */
    }
    let meta: Record<string, any> = {};
    const msgs: any[] = [];
    const lines = text.split("\n").filter((l) => l.trim());
    for (const [i, line] of lines.entries()) {
      try {
        const rec = JSON.parse(line);
        if (i === 0 && rec && typeof rec === "object" && !rec.type) meta = rec;
        else msgs.push(rec);
      } catch {
        /* skip */
      }
    }
    return { meta, msgs };
  }

  readHead(path: string): SessionHead {
    const { meta, msgs } = this.parse(path);

    let firstUserText: string | undefined;
    let lastUserText: string | undefined;
    let model: string | undefined;
    let rounds = 0;
    let messageCount = 0;
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;

    for (const m of msgs) {
      if (!m || typeof m !== "object") continue;
      const role = normalizeRole(String(m.type ?? m.role ?? "other"));
      const text2 = flattenContent(m.content ?? m.parts ?? m.text);
      messageCount++;
      if (typeof m.model === "string" && !model) model = m.model;
      const ts = parseTimestamp(m.timestamp);
      if (ts !== undefined) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
      if (role === "user" && text2) {
        rounds++;
        if (firstUserText === undefined) firstUserText = text2;
        lastUserText = text2;
      }
    }

    const sessionId = (typeof meta.sessionId === "string" && meta.sessionId) || basename(path, ".jsonl");
    const startedAt = Number.isFinite(minTs) ? minTs : parseTimestamp(meta.startTime);
    const endedAt = Number.isFinite(maxTs) ? maxTs : parseTimestamp(meta.lastUpdated);

    let title: string | undefined;
    let titleSource: TitleSource = "none";
    if (typeof meta.summary === "string" && meta.summary) {
      title = truncateTitle(meta.summary);
      titleSource = "summary";
    } else if (firstUserText) {
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
      workspace: undefined,
      projectRoot: undefined,
      modelName: model,
      rounds,
      messageCount,
      startedAt,
      endedAt,
      sourcePath: path,
      backingPath: path,
    };
  }

  read(path: string): CanonicalSession {
    const head = this.readHead(path);
    const { msgs } = this.parse(path);
    const messages: CanonicalMessage[] = [];
    let idx = 0;
    for (const m of msgs) {
      if (!m || typeof m !== "object") continue;
      const role = normalizeRole(String(m.type ?? m.role ?? "other"));
      const content = flattenContent(m.content ?? m.parts ?? m.text);
      const toolCalls: ToolCall[] = [];
      const toolResults: ToolResult[] = [];
      const parts = Array.isArray(m.content) ? m.content : Array.isArray(m.parts) ? m.parts : [];
      for (const p of parts) {
        if (p?.functionCall) toolCalls.push({ name: p.functionCall.name, arguments: p.functionCall.args });
        else if (p?.functionResponse)
          toolResults.push({ callId: p.functionResponse.name, content: flattenContent(p.functionResponse.response), isError: false });
      }
      if (Array.isArray(m.toolCalls)) for (const t of m.toolCalls) toolCalls.push({ name: t.name, arguments: t.args ?? t.arguments });
      if (!content && toolCalls.length === 0 && toolResults.length === 0) continue;
      messages.push({
        idx: idx++,
        role,
        content,
        timestamp: parseTimestamp(m.timestamp),
        nativeId: typeof m.id === "string" ? m.id : undefined,
        isSidechain: m.kind === "subagent",
        toolCalls,
        toolResults,
      });
    }
    return { ...head, messages, messageCount: messages.length };
  }

  resumeCmd(sessionId: string, _logicalPath: string, workspace?: string): ResumeCommand {
    return { program: this.program, args: ["--resume", sessionId], cwd: workspace };
  }
}

export class GeminiProvider extends GeminiLikeProvider {
  constructor() {
    super("Gemini", "gemini", "gemini", join(home(), ".gemini", "tmp"), "gemini");
  }
}

export class QwenProvider extends GeminiLikeProvider {
  constructor() {
    super("Qwen Code", "qwen", "qwen", join(home(), ".qwen", "tmp"), "qwen");
  }
}
