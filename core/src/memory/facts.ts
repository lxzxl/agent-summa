import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { home, listDirs } from "../util";

/**
 * "Learned" auto-fact memory — what an agent writes down as it works. Unlike instruction files,
 * these are bespoke per agent and not portable, so agent-summa only *browses* them (read-only):
 *   • Claude Code: ~/.claude/projects/<encoded-cwd>/memory/ (MEMORY.md index + frontmatter facts)
 *   • Gemini / Qwen: a "## … Added Memories" bullet section appended to GEMINI.md / QWEN.md
 *   • Cursor: stored inside the Cursor app — not a portable file (surfaced as a note only)
 */

function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");
}

export interface MemoryStore {
  /** Encoded project dir name under ~/.claude/projects (the cwd with non-alphanumerics → "-"). */
  key: string;
  /** Absolute path of the memory/ dir. */
  path: string;
  hasIndex: boolean; // MEMORY.md present
  factCount: number; // *.md files excluding MEMORY.md
  mtime: number; // newest file mtime, for sorting
}

/** Enumerate every Claude Code project memory store on disk. */
export function listMemoryStores(): MemoryStore[] {
  const projects = join(claudeHome(), "projects");
  const out: MemoryStore[] = [];
  for (const proj of listDirs(projects)) {
    const dir = join(proj, "memory");
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {
      continue;
    }
    if (names.length === 0) continue;
    let mtime = 0;
    for (const n of names) {
      try {
        mtime = Math.max(mtime, statSync(join(dir, n)).mtimeMs);
      } catch {
        /* race */
      }
    }
    out.push({
      key: proj.split("/").pop() ?? proj,
      path: dir,
      hasIndex: names.includes("MEMORY.md"),
      factCount: names.filter((n) => n !== "MEMORY.md").length,
      mtime: Math.round(mtime),
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export interface MemoryFact {
  file: string; // basename
  name: string;
  description: string;
  type: string; // user | feedback | project | reference | ""
  body: string; // markdown body (frontmatter stripped), truncated
}

/** Minimal frontmatter read: top-level name/description + nested metadata.type, plus the body. */
function parseFact(md: string): { name: string; description: string; type: string; body: string } {
  let name = "";
  let description = "";
  let type = "";
  let body = md;
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end >= 0) {
      const fm = md.slice(3, end);
      body = md.slice(end + 4).replace(/^\s*\n/, "");
      let inMeta = false;
      for (const line of fm.split("\n")) {
        const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (top) {
          const key = top[1];
          const val = (top[2] ?? "").trim().replace(/^["']|["']$/g, "");
          inMeta = key === "metadata";
          if (key === "name") name = val;
          else if (key === "description") description = val;
          continue;
        }
        if (inMeta) {
          const nested = /^\s+type:\s*(.*)$/.exec(line);
          if (nested) type = (nested[1] ?? "").trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  }
  return { name, description, type, body };
}

export interface MemoryStoreDetail {
  index: string; // MEMORY.md content (truncated)
  facts: MemoryFact[];
}

/** Read a Claude memory store: the MEMORY.md index + every fact file's metadata and body. */
export function readMemoryStore(dir: string, bodyCap = 8000): MemoryStoreDetail {
  let index = "";
  const facts: MemoryFact[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".md"));
  } catch {
    return { index, facts };
  }
  for (const n of names.sort()) {
    let raw = "";
    try {
      raw = readFileSync(join(dir, n), "utf8");
    } catch {
      continue;
    }
    if (n === "MEMORY.md") {
      index = raw.length > 24000 ? `${raw.slice(0, 24000)}…` : raw;
      continue;
    }
    const f = parseFact(raw);
    facts.push({
      file: n,
      name: f.name || n.replace(/\.md$/, ""),
      description: f.description,
      type: f.type,
      body: f.body.length > bodyCap ? `${f.body.slice(0, bodyCap)}…` : f.body,
    });
  }
  facts.sort((a, b) => a.name.localeCompare(b.name));
  return { index, facts };
}

/** Parse the "## … Added Memories" bullet section Gemini/Qwen append to GEMINI.md / QWEN.md. */
export function addedMemories(file: string): string[] {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => /^#{1,3}\s+.*Added Memories/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^#{1,3}\s/.test(l)) break; // next heading ends the section
    const m = /^\s*[-*]\s+(.*)$/.exec(l);
    if (m && m[1]?.trim()) out.push(m[1].trim());
  }
  return out;
}
