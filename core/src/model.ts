// Framework-agnostic canonical IR — the app's Rosetta Stone. No Electron / shell imports.
// Clean-room: shaped from public on-disk formats; mirrors no restricted source.

export type MessageRole = "user" | "assistant" | "tool" | "system" | "other";

/** Logical origin tier: UI badge + dedupe namespacing. Same provider can surface via several. */
export type SessionSource = "cli" | "app-code" | "app-web" | "db-backed" | "vm";

export type TitleSource = "custom" | "ai" | "slug" | "summary" | "prompt" | "none";

export interface ToolCall {
  id?: string;
  name: string;
  arguments: unknown; // already JSON-parsed (Codex arguments arrive as a string)
}

export interface ToolResult {
  callId?: string;
  content: string;
  isError: boolean;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  contextTokens: number; // peak single-turn input footprint (context-window proxy)
  costUsd: number;
  model?: string;
}

export interface CanonicalMessage {
  idx: number;
  role: MessageRole;
  content: string;
  timestamp?: number; // epoch millis
  author?: string;
  nativeId?: string;
  parentId?: string; // Claude parentUuid — DAG threading
  isSidechain: boolean;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  extra?: unknown;
}

/** Lightweight metadata from a bounded head+tail read — drives the list before any full parse. */
export interface SessionHead {
  sessionId: string;
  providerSlug: string;
  source: SessionSource;
  title?: string;
  titleSource: TitleSource;
  lastPrompt?: string;
  summary?: string;
  workspace?: string; // decoded real cwd
  projectRoot?: string; // git root (fallback cwd); grouping key
  modelName?: string;
  rounds: number; // approximate for files > 2*64KiB
  messageCount: number; // approximate for large files
  startedAt?: number;
  endedAt?: number; // last activity — sort key
  usage?: SessionUsage;
  /** Logical session path (app-wide unique key). 1-file providers: == backingPath. */
  sourcePath: string;
  /** Physical file we stat for incremental scan. */
  backingPath: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalSession extends SessionHead {
  messages: CanonicalMessage[];
}

// ---- pure helpers (clean-room) ----

const MS_THRESHOLD = 100_000_000_000; // ~1973 in ms; below => seconds

export function parseTimestamp(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return value < MS_THRESHOLD ? Math.round(value * 1000) : Math.round(value);
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return parseTimestamp(Number(value));
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

export function normalizeRole(role: string): MessageRole {
  const r = role.toLowerCase();
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "model" || r === "agent" || r === "gemini" || r === "ai") return "assistant";
  if (r === "tool") return "tool";
  if (r === "system" || r === "developer") return "system";
  return "other";
}

export function truncateTitle(text: string, max = 80): string {
  const line = (text ?? "").split("\n").map((s) => s.trim()).find((s) => s.length > 0) ?? "";
  if (line.length <= max) return line;
  return line.slice(0, max - 1).trimEnd() + "…";
}

/** Flatten heterogeneous content (string | block array | {parts:[..]}) to plain text. */
export function flattenContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenContent).filter(Boolean).join("");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.parts)) return (o.parts as unknown[]).map(flattenContent).join("");
    if (o.type === "text" && typeof o.text === "string") return o.text;
  }
  return "";
}
