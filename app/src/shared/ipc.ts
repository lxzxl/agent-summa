// Typed IPC contract shared by main (handlers) and renderer (window.api).

export interface ScanResult {
  total: number;
  parsed: number;
  appCode: number;
  vmLocked: number;
  count: number;
}

export interface AgentRow {
  slug: string;
  name: string;
  count: number;
}

export interface SessionRow {
  sessionPath: string;
  sessionId: string;
  provider: string;
  source: string;
  title: string | null;
  lastPrompt: string | null;
  project: string | null;
  workspace: string | null;
  model: string | null;
  rounds: number;
  startedAt: number | null;
  endedAt: number | null;
  status: string | null; // "active" | "interrupted" | "empty" | "orphaned" | null
  subagents: number; // child agents this session spawned (Task + workflow); 0 if none
  workflows: number; // distinct workflow runs among them
}


export interface SearchHit {
  sessionPath: string;
  title: string | null;
  provider: string;
  project: string | null;
  snip: string;
  via: "title" | "project" | "prompt" | "content"; // which field matched
}

export interface SkillRow {
  name: string;
  description?: string;
  agents: string[];
  conflict: boolean;
}

export interface SkillInstall {
  agent: string;
  path: string; // the skill dir in that agent
  type: "link" | "dir"; // symlink vs real directory
  target: string | null; // symlink destination (the source it points at)
  managed: boolean; // created by agent-summa's distribution (in manifest)
}

export interface SkillDetail {
  name: string;
  description: string | null;
  installs: SkillInstall[];
  source: string | null; // resolved canonical/real copy
  skillMd: string; // SKILL.md content (truncated)
}

export interface SessionQuery {
  limit?: number;
  provider?: string;
  source?: string;
  project?: string;
}

export interface ResumeResult {
  ok: boolean;
  command: string;
  launched: boolean;
}

export interface ForkResult {
  targetSlug: string;
  path: string;
  sessionId: string;
  resume: string;
  turns: number;
}

export interface TranscriptMessage {
  idx: number;
  role: string; // user | assistant | tool | system | other
  text: string;
  tools: string[]; // tool-call names attached to this message
  ts: number | null;
}

export interface TranscriptResult {
  ok: boolean;
  reason: string; // "ok" | "vm-locked" | "unsupported" | "not-found" | <error>
  total: number; // total messages in the session
  truncated: boolean; // true when messages were capped
  messages: TranscriptMessage[];
}

export interface SubagentRow {
  path: string;
  kind: string; // "task" | "workflow"
  workflowId: string | null;
  label: string | null;
  rounds: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface SubagentsResult {
  total: number;
  truncated: boolean;
  items: SubagentRow[];
}

// ── Memory: cross-agent instruction/context files (3a) ──────────────────────
export interface ContextSlot {
  filename: string; // "CLAUDE.md" | "AGENTS.md" | "GEMINI.md" | "QWEN.md" | ".cursorrules" | …
  path: string;
  agents: string[]; // agent slugs that read this file
  exists: boolean;
  empty: boolean; // present but 0 bytes
  isLink: boolean;
  linkTarget?: string;
  size: number;
  hash?: string; // content hash (sha256[:12]); absent when missing/empty
  managed: boolean; // this link was created by agent-summa (safe to unlink/restore)
}

export interface ContextScope {
  id: string; // "global" | project dir
  kind: "global" | "project";
  label: string;
  slots: ContextSlot[];
  present: number;
  covered: string[]; // agent slugs covered by ≥1 existing slot
  divergent: boolean; // existing slots disagree on content
  canonical?: string; // suggested source-of-truth path
}

export interface ConvergeResult {
  linked: number;
  skipped: number;
  backedUp: string[];
  errors: string[];
}

// ── Memory: learned auto-fact stores (3b, read-only) ────────────────────────
export interface MemoryFact {
  file: string;
  name: string;
  description: string;
  type: string; // user | feedback | project | reference | ""
  body: string;
}

export interface MemoryStoreDetail {
  index: string; // MEMORY.md content
  facts: MemoryFact[];
}

// A session's project memory: its instruction-file scope (always built) + its cwd's learned store.
export interface ProjectMemory {
  scope: ContextScope | null;
  store: { path: string; label: string; factCount: number } | null;
}

// Per-agent config card (shown when a sidebar agent is selected).
export interface AgentConfigInfo {
  slug: string;
  name: string;
  installed: boolean;
  version: string | null;
  home: string;
  sessions: number;
  skills: number;
  globalSlot: ContextSlot | null; // this agent's home-level instruction file
  canonical: string | null; // the global source-of-truth to link to
}

// Pushed from main (forwarded from the FTS worker) so the UI can show indexing state.
export type FtsProgress =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number }
  | { type: "done"; indexed: number; total: number }
  | { type: "error"; message: string };

export interface Api {
  scan(): Promise<ScanResult>;
  agents(): Promise<AgentRow[]>;
  sessions(opts?: SessionQuery): Promise<SessionRow[]>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  skills(): Promise<SkillRow[]>;
  resume(s: { sessionId: string; provider: string; cwd?: string }): Promise<ResumeResult>;
  transcript(sessionPath: string): Promise<TranscriptResult>;
  subagents(sessionPath: string): Promise<SubagentsResult>;
  resumeCommand(s: { sessionId: string; provider: string; cwd?: string }): Promise<{ command: string; cwd: string | null; displayOnly: boolean }>;
  copy(text: string): Promise<void>;
  fork(s: { sessionPath: string; targetSlug: string }): Promise<ForkResult | { error: string }>;
  skillTargets(): Promise<string[]>;
  skillSpread(name: string): Promise<{ linked: number; skipped: number; error?: string }>;
  skillInstall(name: string, agentSlug: string): Promise<{ linked: number; skipped: number; error?: string }>;
  skillRemove(name: string, agentSlug: string): Promise<{ removed: boolean; wasLink: boolean; error?: string }>;
  skillRemoveAll(name: string): Promise<{ removed: number }>;
  skillDetail(name: string): Promise<SkillDetail | null>;
  skillUninstall(): Promise<{ removed: number }>;
  contextRead(path: string): Promise<{ content: string; truncated: boolean }>;
  contextConverge(arg: { scope: string; canonical: string; targets: { path: string; agent: string }[] }): Promise<ConvergeResult>;
  contextUnlink(path: string): Promise<{ removed: boolean; restored: boolean; error?: string }>;
  memoryStoreRead(path: string): Promise<MemoryStoreDetail>;
  projectMemory(project: string | null, workspace: string | null): Promise<ProjectMemory>;
  agentConfig(slug: string): Promise<AgentConfigInfo>;
  /** Subscribe to background FTS-indexing progress; returns an unsubscribe fn. */
  onFtsProgress(cb: (p: FtsProgress) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
