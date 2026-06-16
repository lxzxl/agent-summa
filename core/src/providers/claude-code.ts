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
  type ToolCall,
  type ToolResult,
} from "../model";
import type { DetectionResult, Provider, ResumeCommand } from "../provider";
import { gitRoot, home, listDirs, listFilesShallow, readAllRecords, walkFiles } from "../util";

// Child agents a CC session spawned live beside it, under <session>/subagents/ —
// Task spawns as agent-*.jsonl, workflow agents nested under workflows/<wfId>/.
const isSubagentFile = (name: string): boolean => name.startsWith("agent-") && name.endsWith(".jsonl");
export function subagentDir(sessionPath: string): string {
  return `${sessionPath.replace(/\.jsonl$/, "")}/subagents`;
}
export function countSubagents(sessionPath: string): { agents: number; workflows: number } {
  const dir = subagentDir(sessionPath);
  if (!existsSync(dir)) return { agents: 0, workflows: 0 };
  const files = walkFiles(dir, isSubagentFile);
  const wf = new Set<string>();
  for (const f of files) {
    const m = /\/(wf_[^/]+)\//.exec(f);
    if (m?.[1]) wf.add(m[1]);
  }
  return { agents: files.length, workflows: wf.size };
}

export interface SubagentRef {
  path: string;
  kind: "task" | "workflow";
  workflowId: string | null;
}
/** Enumerate a session's child-agent transcript files (Task spawns + workflow agents). */
export function listSubagents(sessionPath: string): SubagentRef[] {
  const dir = subagentDir(sessionPath);
  if (!existsSync(dir)) return [];
  return walkFiles(dir, isSubagentFile).map((f) => {
    const m = /\/(wf_[^/]+)\//.exec(f);
    return { path: f, kind: m ? "workflow" : "task", workflowId: m?.[1] ?? null };
  });
}

function claudeRoot(): string {
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  return cfg ? cfg : join(home(), ".claude");
}

type ConvRec = { o: Record<string, any> };

/**
 * Order conversation records by the parentUuid DAG, not file order. The main line is the ancestry
 * of the latest non-sidechain leaf (correct under edits/branching); everything off that path
 * (sidechains, superseded edit branches) is appended and flagged so the UI can fold it.
 */
function linearizeByParent(conv: ConvRec[]): Array<{ o: Record<string, any>; sidechain: boolean }> {
  const byUuid = new Map<string, ConvRec>();
  for (const c of conv) if (typeof c.o.uuid === "string") byUuid.set(c.o.uuid, c);
  const referenced = new Set<string>();
  for (const c of conv) if (typeof c.o.parentUuid === "string") referenced.add(c.o.parentUuid);
  const ts = (c?: ConvRec): number => (c ? parseTimestamp(c.o.timestamp) ?? 0 : -1);
  const leaves = conv.filter((c) => typeof c.o.uuid === "string" && !referenced.has(c.o.uuid) && !c.o.isSidechain);
  let cur: ConvRec | undefined = leaves.length
    ? leaves.reduce((a, b) => (ts(b) >= ts(a) ? b : a))
    : conv.filter((c) => !c.o.isSidechain).at(-1);

  const main: ConvRec[] = [];
  const seen = new Set<string>();
  while (cur && typeof cur.o.uuid === "string" && !seen.has(cur.o.uuid)) {
    main.push(cur);
    seen.add(cur.o.uuid);
    const pid = cur.o.parentUuid;
    cur = typeof pid === "string" ? byUuid.get(pid) : undefined;
  }
  main.reverse();

  const out = main.map((c) => ({ o: c.o, sidechain: false }));
  for (const c of conv) {
    if (typeof c.o.uuid !== "string" || !seen.has(c.o.uuid)) out.push({ o: c.o, sidechain: true });
  }
  return out;
}

export class ClaudeCodeProvider implements Provider {
  readonly name = "Claude Code";
  readonly slug = "claude-code";
  readonly cliAlias = "cc";

  detect(): DetectionResult {
    const root = claudeRoot();
    const installed = existsSync(join(root, "projects"));
    return { installed, evidence: installed ? [join(root, "projects")] : [] };
  }

  sessionRoots(): string[] {
    return [join(claudeRoot(), "projects")];
  }

  skillsDir(): string | undefined {
    return join(claudeRoot(), "skills");
  }

  ownsPath(path: string): boolean {
    return path.includes(`${join(".claude", "projects")}`) && path.endsWith(".jsonl");
  }

  list(): string[] {
    const out: string[] = [];
    for (const root of this.sessionRoots()) {
      for (const projDir of listDirs(root)) {
        out.push(...listFilesShallow(projDir, ".jsonl"));
      }
    }
    return out;
  }

  readHead(path: string): SessionHead {
    const sessionId = basename(path, ".jsonl");
    // Full scan (not head/tail window): rounds must count every real turn, and tool
    // results (also type:"user") must be excluded — both impossible from a byte window.
    const recs = readAllRecords(path);

    let cwd: string | undefined;
    let model: string | undefined;
    let customTitle: string | undefined;
    let aiTitle: string | undefined;
    let lastPromptRec: string | undefined;
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
      if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
      const ts = parseTimestamp(o.timestamp);
      if (ts !== undefined) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
      switch (o.type) {
        case "user": {
          if (o.isMeta || o.isCompactSummary) break;
          messageCount++;
          // tool_result blocks are also type:"user" but carry no text → flattenContent
          // returns "" → not a real round. Only text-bearing turns count.
          const t = flattenContent(o.message?.content);
          if (t.startsWith("[Request interrupted by user")) {
            interrupted = true; // user aborted this turn — not a real prompt
          } else if (t) {
            interrupted = false;
            rounds++;
            if (firstUserText === undefined) firstUserText = t;
            lastUserText = t;
          }
          break;
        }
        case "assistant": {
          messageCount++;
          interrupted = false; // the agent replied after → session didn't end on an interrupt
          const m = o.message?.model;
          if (!model && typeof m === "string" && m !== "<synthetic>") model = m;
          break;
        }
        case "custom-title":
          if (typeof o.customTitle === "string") customTitle = o.customTitle;
          break;
        case "ai-title":
          if (typeof o.aiTitle === "string") aiTitle = o.aiTitle;
          break;
        case "last-prompt":
          if (typeof o.lastPrompt === "string") lastPromptRec = o.lastPrompt;
          break;
        default:
          break;
      }
    }

    let title: string | undefined;
    let titleSource: TitleSource = "none";
    if (customTitle) {
      title = customTitle;
      titleSource = "custom";
    } else if (aiTitle) {
      title = aiTitle;
      titleSource = "ai";
    } else if (firstUserText) {
      title = truncateTitle(firstUserText);
      titleSource = "prompt";
    }

    const lastPrompt = lastPromptRec ?? (lastUserText ? truncateTitle(lastUserText, 120) : undefined);
    const workspace = cwd;
    const projectRoot = gitRoot(cwd);

    const meta: Record<string, unknown> = {};
    if (interrupted) meta.interrupted = true;
    const sa = countSubagents(path);
    if (sa.agents) {
      meta.subagents = sa.agents;
      meta.workflows = sa.workflows;
    }

    return {
      sessionId,
      providerSlug: this.slug,
      source: "cli",
      title,
      titleSource,
      lastPrompt,
      workspace,
      projectRoot,
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
    const conv: ConvRec[] = [];
    for (const r of recs) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, any>;
      if ((o.type === "user" || o.type === "assistant") && !o.isMeta) conv.push({ o });
    }
    const messages: CanonicalMessage[] = [];
    let idx = 0;
    for (const { o, sidechain } of linearizeByParent(conv)) {
      const text = flattenContent(o.message?.content);
      const toolCalls: ToolCall[] = [];
      const toolResults: ToolResult[] = [];
      const blocks = Array.isArray(o.message?.content) ? o.message.content : [];
      for (const b of blocks) {
        if (b?.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, arguments: b.input });
        else if (b?.type === "tool_result")
          toolResults.push({ callId: b.tool_use_id, content: flattenContent(b.content), isError: !!b.is_error });
      }
      // A "user" turn that carries only tool_result blocks is the tool's output, not a
      // human prompt — classify it as a tool message (with the result text as content) so
      // it doesn't render as an empty "you" bubble. Mirrors the codex provider.
      const isToolResult = o.type === "user" && !text && toolResults.length > 0;
      const role: MessageRole = o.type === "assistant" ? "assistant" : isToolResult ? "tool" : "user";
      const content = isToolResult ? toolResults.map((t) => t.content).filter(Boolean).join("\n\n") : text;
      if (!content && toolCalls.length === 0) continue;
      messages.push({
        idx: idx++,
        role,
        content,
        timestamp: parseTimestamp(o.timestamp),
        nativeId: o.uuid,
        parentId: o.parentUuid ?? undefined,
        isSidechain: sidechain || !!o.isSidechain,
        toolCalls,
        toolResults,
      });
    }
    // Resumed/compacted sessions break the parentUuid chain, so the leaf-walk leaves
    // an out-of-order tail. Chronological order is the intuitive transcript view.
    messages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    messages.forEach((m, i) => {
      m.idx = i;
    });
    return { ...head, messages, messageCount: messages.length };
  }

  resumeCmd(sessionId: string, _logicalPath: string, workspace?: string): ResumeCommand {
    return { program: "claude", args: ["--resume", sessionId], cwd: workspace };
  }
}
