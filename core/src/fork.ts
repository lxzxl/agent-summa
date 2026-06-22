import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalMessage, CanonicalSession } from "./model";
import type { ProviderRegistry } from "./provider";

export interface ForkResult {
  targetSlug: string;
  path: string;
  sessionId: string;
  resume: string;
  turns: number;
}

/** Tool calls/results → prose (the lossy part of cross-agent fork; structure not preserved). */
function toolProse(m: CanonicalMessage): string {
  const parts: string[] = [];
  for (const t of m.toolCalls) {
    const args = JSON.stringify(t.arguments ?? {});
    parts.push(`[ran ${t.name}(${args.length > 140 ? `${args.slice(0, 140)}…` : args})]`);
  }
  for (const r of m.toolResults) {
    parts.push(`[tool result${r.isError ? " (error)" : ""}: ${r.content.slice(0, 240)}]`);
  }
  return parts.join("\n");
}

function messageText(m: CanonicalMessage): string {
  return [m.content, toolProse(m)].filter(Boolean).join("\n");
}

function forkBanner(session: CanonicalSession): string {
  return `[Forked from ${session.providerSlug} session ${session.sessionId} by agent-summa — prior context follows. Tool calls were collapsed to text; this is a context-carry, not a byte-faithful resume.]`;
}

/** Write the carried context as a resumable Claude Code transcript. */
export function writeClaudeFork(session: CanonicalSession, outDir: string): ForkResult {
  const id = randomUUID();
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${id}.jsonl`);
  const cwd = session.workspace ?? process.cwd();
  const lines: string[] = [];
  let parent: string | null = null;
  const push = (role: "user" | "assistant", text: string, ts?: number): void => {
    const uuid = randomUUID();
    const message =
      role === "user"
        ? { role: "user", content: text }
        : { role: "assistant", model: session.modelName ?? "<fork>", content: [{ type: "text", text }] };
    lines.push(
      JSON.stringify({
        parentUuid: parent,
        isSidechain: false,
        type: role,
        uuid,
        timestamp: new Date(ts ?? Date.now()).toISOString(),
        sessionId: id,
        cwd,
        version: "fork",
        message,
      }),
    );
    parent = uuid;
  };
  push("user", forkBanner(session));
  for (const m of session.messages) {
    const text = messageText(m);
    if (!text) continue;
    push(m.role === "user" ? "user" : "assistant", text, m.timestamp);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
  return { targetSlug: "claude-code", path, sessionId: id, resume: `claude --resume ${id}`, turns: lines.length };
}

/** Write the carried context as a resumable Codex rollout. */
export function writeCodexFork(session: CanonicalSession, outDir: string): ForkResult {
  const id = randomUUID();
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `rollout-fork-${id}.jsonl`);
  const cwd = session.workspace ?? process.cwd();
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: "session_meta",
      payload: { id, cwd, originator: "agent-summa-fork", cli_version: "fork", model: session.modelName },
    }),
  );
  const push = (role: "user" | "assistant", text: string, ts?: number): void => {
    lines.push(
      JSON.stringify({
        type: "response_item",
        timestamp: new Date(ts ?? Date.now()).toISOString(),
        payload: {
          type: "message",
          role,
          content: [{ type: role === "user" ? "input_text" : "output_text", text }],
        },
      }),
    );
  };
  push("user", forkBanner(session));
  for (const m of session.messages) {
    const text = messageText(m);
    if (!text) continue;
    push(m.role === "user" ? "user" : "assistant", text, m.timestamp);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
  return { targetSlug: "codex", path, sessionId: id, resume: `codex resume ${id}`, turns: lines.length - 1 };
}

/** Write the carried context as a resumable oh-my-pi (omp) session JSONL. */
export function writeOmpFork(session: CanonicalSession, outDir: string): ForkResult {
  const id = randomUUID();
  mkdirSync(outDir, { recursive: true });
  const now = new Date();
  // omp session filename: ISO timestamp with `:`/`.` rewritten to `-`, then `_<id>.jsonl`.
  const path = join(outDir, `${now.toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
  const cwd = session.workspace ?? process.cwd();
  const lines: string[] = [
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: now.toISOString(),
      cwd,
      title: session.title ?? "Forked session",
      titleSource: "auto",
      parentSession: session.sessionId,
    }),
  ];
  let parent: string | null = null;
  // Stamp entries on a monotonic clock from fork time so the banner stays first when the new
  // session replays in chronological order (carried turns' original timestamps are irrelevant).
  const base = now.getTime();
  let seq = 0;
  const push = (role: "user" | "assistant", text: string): void => {
    const eid = randomUUID().replace(/-/g, "").slice(0, 8);
    const stamp = base + seq++;
    lines.push(
      JSON.stringify({
        type: "message",
        id: eid,
        parentId: parent,
        timestamp: new Date(stamp).toISOString(),
        message: { role, content: [{ type: "text", text }], attribution: role === "user" ? "user" : "agent", timestamp: stamp },
      }),
    );
    parent = eid;
  };
  push("user", forkBanner(session));
  for (const m of session.messages) {
    const text = messageText(m);
    if (!text) continue;
    push(m.role === "user" ? "user" : "assistant", text);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
  return { targetSlug: "omp", path, sessionId: id, resume: `omp --resume ${id}`, turns: lines.length - 1 };
}

const WRITERS: Record<string, (s: CanonicalSession, out: string) => ForkResult> = {
  "claude-code": writeClaudeFork,
  codex: writeCodexFork,
  omp: writeOmpFork,
};

/** Fork a source session (read via its owning provider) into a target agent's format. */
export function fork(reg: ProviderRegistry, sourcePath: string, targetSlug: string, outDir: string): ForkResult {
  const owner = reg.ownerOf(sourcePath);
  if (!owner?.read) throw new Error(`no reader for ${sourcePath}`);
  const writer = WRITERS[targetSlug];
  if (!writer) throw new Error(`no fork writer for target "${targetSlug}" (have: ${Object.keys(WRITERS).join(", ")})`);
  return writer(owner.read(sourcePath), outDir);
}
