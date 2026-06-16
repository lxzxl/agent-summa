import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProviderRegistry } from "../provider";
import { home, listDirs } from "../util";

export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/** Minimal SKILL.md frontmatter parser: handles `name:`/`description:`, inline or folded (`>-`/`|`). */
export function parseFrontmatter(md: string): SkillFrontmatter {
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end < 0) return {};
  const lines = md.slice(3, end).split("\n");
  const out: SkillFrontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([a-zA-Z_]+):\s*(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const key = m[1];
    let val = (m[2] ?? "").trim();
    if (val === ">-" || val === ">" || val === "|" || val === "|-") {
      const buf: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? "";
        if (/^\s+\S/.test(l)) {
          buf.push(l.trim());
          i = j;
        } else if (l.trim() === "") {
          i = j;
        } else {
          break;
        }
      }
      val = buf.join(" ");
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
  }
  return out;
}

export interface SkillEntry {
  name: string;
  description?: string;
  /** Agent/source slugs that have this skill installed. */
  agents: string[];
  dirs: string[];
  /** True when installs disagree on content (description differs) → version/drift suspicion. */
  conflict: boolean;
}

interface SkillRoot {
  agent: string;
  dir: string;
}

/** Resolve every skills directory: per-agent (provider.skillsDir) + shared/cross-tool dirs. */
export function skillRoots(reg: ProviderRegistry): SkillRoot[] {
  const roots: SkillRoot[] = [];
  for (const p of reg.all()) {
    const d = p.skillsDir();
    if (d && d.endsWith("skills")) roots.push({ agent: p.slug, dir: d });
  }
  roots.push({ agent: "agents", dir: join(home(), ".agents", "skills") });
  roots.push({ agent: "cursor", dir: join(home(), ".cursor", "skills") });
  roots.push({ agent: "copilot", dir: join(home(), ".copilot", "skills") });
  roots.push({ agent: "gemini", dir: join(home(), ".gemini", "skills") });
  roots.push({ agent: "qwen", dir: join(home(), ".qwen", "skills") });
  // dedupe by dir
  const seen = new Set<string>();
  return roots.filter((r) => (seen.has(r.dir) ? false : (seen.add(r.dir), true)));
}

/** Build the skill × agent install matrix across all skills directories. */
export function scanSkills(reg: ProviderRegistry): SkillEntry[] {
  const map = new Map<
    string,
    { description?: string; agents: Set<string>; dirs: string[]; descs: Set<string> }
  >();
  for (const { agent, dir } of skillRoots(reg)) {
    for (const sub of listDirs(dir)) {
      const skp = join(sub, "SKILL.md");
      if (!existsSync(skp)) continue;
      let fm: SkillFrontmatter = {};
      try {
        fm = parseFrontmatter(readFileSync(skp, "utf8"));
      } catch {
        /* ignore unreadable */
      }
      const name = fm.name || basename(sub);
      const e = map.get(name) ?? { description: fm.description, agents: new Set(), dirs: [], descs: new Set() };
      e.agents.add(agent);
      e.dirs.push(skp);
      if (fm.description) {
        e.descs.add(fm.description.slice(0, 120));
        if (!e.description) e.description = fm.description;
      }
      map.set(name, e);
    }
  }
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      description: e.description,
      agents: [...e.agents].sort(),
      dirs: e.dirs,
      conflict: e.descs.size > 1,
    }))
    .sort((a, b) => b.agents.length - a.agents.length || a.name.localeCompare(b.name));
}
