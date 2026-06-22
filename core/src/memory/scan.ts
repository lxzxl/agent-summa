import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { home } from "../util";

/**
 * Cross-agent "context / instructions" files — the steering memory every agent reads
 * (CLAUDE.md / AGENTS.md / GEMINI.md / QWEN.md / .cursorrules / copilot-instructions.md).
 * These are interchangeable markdown; only the *filename* differs per agent, so one canonical
 * file can be symlinked under every name → "write once, every agent reads it".
 */

export interface ContextSlot {
  /** Bare filename shown in the matrix, e.g. "CLAUDE.md", "AGENTS.md". */
  filename: string;
  /** Absolute path on disk. */
  path: string;
  /** Agent slugs that read this file. */
  agents: string[];
  exists: boolean;
  empty: boolean; // present but 0 bytes (e.g. an untouched ~/.gemini/GEMINI.md)
  isLink: boolean;
  linkTarget?: string; // raw readlink() target when a symlink
  size: number;
  mtime?: number;
  /** sha256[:12] of the resolved content; undefined when absent/unreadable. Symlinks hash their target. */
  hash?: string;
}

export interface ContextScope {
  id: string; // "global" | absolute project dir
  kind: "global" | "project";
  label: string;
  slots: ContextSlot[];
  present: number; // # of existing (non-missing) slots
  /** Agent slugs covered by at least one existing slot. */
  covered: string[];
  /** ≥2 existing non-empty slots whose content hashes differ → duplicated/drifted maintenance. */
  divergent: boolean;
  /** Suggested canonical source for convergence: the richest real file (most bytes, newest). */
  canonical?: string;
}

/** Per-agent config home (mirrors each provider's real location; honors the usual env overrides). */
function agentHome(slug: string): string {
  const h = home();
  switch (slug) {
    case "claude-code":
      return process.env.CLAUDE_CONFIG_DIR || join(h, ".claude");
    case "codex":
      return process.env.CODEX_HOME || join(h, ".codex");
    case "gemini":
      return join(h, ".gemini");
    case "qwen":
      return join(h, ".qwen");
    case "opencode":
      return join(h, ".config", "opencode");
    case "omp":
      return process.env.PI_CODING_AGENT_DIR || join(process.env.PI_CONFIG_DIR || join(h, ".omp"), "agent");
    default:
      return join(h, `.${slug}`);
  }
}

// Global scope: one instruction file per agent home (codex & opencode both use AGENTS.md, but
// in different dirs → two distinct slots).
const GLOBAL_SLOTS: { agent: string; filename: string }[] = [
  { agent: "claude-code", filename: "CLAUDE.md" },
  { agent: "codex", filename: "AGENTS.md" },
  { agent: "gemini", filename: "GEMINI.md" },
  { agent: "qwen", filename: "QWEN.md" },
  { agent: "opencode", filename: "AGENTS.md" },
  { agent: "omp", filename: "AGENTS.md" },
];

// Project scope: files at the project root. The core four are always shown (so missing ones can be
// created+converged); the legacy/extra ones only appear when they already exist.
interface ProjectSlotSpec {
  rel: string;
  agents: string[];
  always: boolean;
}
const PROJECT_SLOTS: ProjectSlotSpec[] = [
  { rel: "CLAUDE.md", agents: ["claude-code"], always: true },
  { rel: "AGENTS.md", agents: ["codex", "opencode", "omp"], always: true }, // also read by copilot/cursor & omp
  { rel: "GEMINI.md", agents: ["gemini"], always: true },
  { rel: "QWEN.md", agents: ["qwen"], always: true },
  { rel: ".cursorrules", agents: ["cursor"], always: false },
  { rel: ".github/copilot-instructions.md", agents: ["copilot"], always: false },
];

function inspectSlot(filename: string, path: string, agents: string[]): ContextSlot {
  const slot: ContextSlot = { filename, path, agents, exists: false, empty: false, isLink: false, size: 0 };
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path); // follows symlinks → reflects the real target's size/mtime
  } catch {
    return slot; // missing (or dangling symlink) → treat as absent
  }
  slot.exists = true;
  slot.size = st.size;
  slot.empty = st.size === 0;
  slot.mtime = Math.round(st.mtimeMs);
  try {
    if (lstatSync(path).isSymbolicLink()) {
      slot.isLink = true;
      slot.linkTarget = readlinkSync(path);
    }
  } catch {
    /* race */
  }
  try {
    const buf = readFileSync(path);
    if (buf.length > 0) slot.hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  } catch {
    /* unreadable → no hash */
  }
  return slot;
}

function finishScope(id: string, kind: "global" | "project", label: string, slots: ContextSlot[]): ContextScope {
  const existing = slots.filter((s) => s.exists);
  const covered = [...new Set(existing.flatMap((s) => s.agents))].sort();
  const hashes = new Set(existing.filter((s) => !s.empty && s.hash).map((s) => s.hash));
  // Canonical = richest real (non-link, non-empty) file; fall back to a non-empty link's content.
  const real = existing.filter((s) => !s.isLink && !s.empty).sort((a, b) => b.size - a.size || (b.mtime ?? 0) - (a.mtime ?? 0));
  const link = existing.filter((s) => s.isLink && !s.empty).sort((a, b) => b.size - a.size);
  return {
    id,
    kind,
    label,
    slots,
    present: existing.length,
    covered,
    divergent: hashes.size > 1,
    canonical: real[0]?.path ?? link[0]?.path,
  };
}

/** Build the Global context scope (each agent's home-level instruction file). */
export function globalContextScope(): ContextScope {
  const slots = GLOBAL_SLOTS.map((g) => inspectSlot(g.filename, join(agentHome(g.agent), g.filename), [g.agent]));
  return finishScope("global", "global", "Global", slots);
}

/**
 * Build a project context scope for one project dir. Returns undefined if it has no slot files,
 * unless `keepEmpty` (used when showing a specific project's matrix on demand, so the user can
 * create files even when none exist yet).
 */
export function projectContextScope(dir: string, keepEmpty = false): ContextScope | undefined {
  if (!dir || !existsSync(dir)) return undefined;
  const slots: ContextSlot[] = [];
  for (const spec of PROJECT_SLOTS) {
    const p = join(dir, spec.rel);
    const s = inspectSlot(spec.rel, p, spec.agents);
    if (spec.always || s.exists) slots.push(s);
  }
  const scope = finishScope(dir, "project", dir.split("/").pop() || dir, slots);
  return scope.present > 0 || keepEmpty ? scope : undefined; // skip projects with zero instruction files
}

/**
 * All context scopes: Global first, then every project dir (from the session index) that has
 * at least one instruction file. `projectDirs` is typically the distinct `project_root` set.
 */
export function contextScopes(projectDirs: string[]): ContextScope[] {
  const out: ContextScope[] = [globalContextScope()];
  const seen = new Set<string>();
  for (const dir of projectDirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const s = projectContextScope(dir);
    if (s) out.push(s);
  }
  // Projects with the most coverage / divergence first; Global stays pinned at the top.
  const [g, ...rest] = out;
  rest.sort((a, b) => Number(b.divergent) - Number(a.divergent) || b.present - a.present || a.label.localeCompare(b.label));
  return g ? [g, ...rest] : rest;
}
