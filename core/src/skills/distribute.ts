import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { listDirs } from "../util";

export type LinkMode = "symlink" | "junction" | "copy";

export interface DeployRecord {
  skill: string;
  agent: string;
  target: string;
  mode: LinkMode;
}

export interface Manifest {
  version: 1;
  central: string;
  deploys: DeployRecord[];
}

export interface DistTarget {
  agent: string;
  dir: string;
}

function loadManifest(p: string): Manifest {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Manifest;
  } catch {
    return { version: 1, central: "", deploys: [] };
  }
}

function saveManifest(p: string, m: Manifest): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
}

/** Link `src` skill dir to `dest`. symlink → junction(Windows) → copy fallback. */
function linkOne(src: string, dest: string, mode: LinkMode): LinkMode {
  mkdirSync(dirname(dest), { recursive: true });
  if (mode === "copy") {
    cpSync(src, dest, { recursive: true });
    return "copy";
  }
  try {
    symlinkSync(src, dest, process.platform === "win32" ? "junction" : "dir");
    return process.platform === "win32" ? "junction" : "symlink";
  } catch {
    cpSync(src, dest, { recursive: true });
    return "copy"; // Windows w/o dev mode, or cross-device → copy
  }
}

/**
 * Distribute every skill in `centralDir` (a `~/.agents/skills`-style source) into each target
 * agent's skills dir. Only creates new links; never clobbers a skill the user already has there.
 * Every link is recorded in the manifest so it can be removed cleanly.
 */
export function distributeSkills(opts: {
  centralDir: string;
  targets: DistTarget[];
  manifestPath: string;
  mode?: LinkMode;
}): { linked: number; skipped: number; manifest: Manifest } {
  const m = loadManifest(opts.manifestPath);
  m.central = opts.centralDir;
  let linked = 0;
  let skipped = 0;
  for (const skillDir of listDirs(opts.centralDir)) {
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;
    const skill = basename(skillDir);
    for (const t of opts.targets) {
      const dest = join(t.dir, skill);
      if (existsSync(dest)) {
        skipped++;
        continue; // respect the user's existing skill
      }
      const mode = linkOne(skillDir, dest, opts.mode ?? "symlink");
      m.deploys.push({ skill, agent: t.agent, target: dest, mode });
      linked++;
    }
  }
  saveManifest(opts.manifestPath, m);
  return { linked, skipped, manifest: m };
}

/**
 * Spread ONE skill into each target agent that doesn't already have it. Source is an existing
 * skill dir (e.g. the copy that lives in one agent). Records links in the manifest for clean removal.
 */
export function spreadSkill(opts: {
  skillDir: string;
  targets: DistTarget[];
  manifestPath: string;
  mode?: LinkMode;
}): { linked: number; skipped: number } {
  const m = loadManifest(opts.manifestPath);
  if (!m.central) m.central = "(per-skill spread)";
  const skill = basename(opts.skillDir);
  let linked = 0;
  let skipped = 0;
  for (const t of opts.targets) {
    const dest = join(t.dir, skill);
    if (existsSync(dest)) {
      skipped++;
      continue; // respect an existing skill there
    }
    const mode = linkOne(opts.skillDir, dest, opts.mode ?? "symlink");
    m.deploys.push({ skill, agent: t.agent, target: dest, mode });
    linked++;
  }
  saveManifest(opts.manifestPath, m);
  return { linked, skipped };
}

/**
 * Remove one skill directory — a symlink (safe: source elsewhere is untouched) OR a real dir
 * (destructive: deletes the actual files). Prunes any manifest entry that pointed at it.
 */
export function removeSkillDir(dir: string, manifestPath: string): { removed: boolean; wasLink: boolean } {
  let wasLink = false;
  try {
    wasLink = lstatSync(dir).isSymbolicLink();
  } catch {
    return { removed: false, wasLink: false }; // nothing there
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    return { removed: false, wasLink };
  }
  const m = loadManifest(manifestPath);
  const before = m.deploys.length;
  m.deploys = m.deploys.filter((d) => d.target !== dir);
  if (m.deploys.length !== before) saveManifest(manifestPath, m);
  return { removed: true, wasLink };
}

/** Remove only manifest-recorded links (the user's own skills are never touched). */
export function uninstallSkills(manifestPath: string): { removed: number } {
  const m = loadManifest(manifestPath);
  let removed = 0;
  for (const d of m.deploys) {
    if (existsSync(d.target)) {
      try {
        rmSync(d.target, { recursive: true, force: true });
        removed++;
      } catch {
        /* best effort */
      }
    }
  }
  m.deploys = [];
  saveManifest(manifestPath, m);
  return { removed };
}
