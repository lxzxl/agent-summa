import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { LinkMode } from "../skills/distribute";

/**
 * Convergence of cross-agent instruction files: pick one canonical file and point every other
 * agent's file at it (symlink), so editing one updates all. Divergent real files are backed up
 * before being replaced — never silently clobbered.
 */

export interface ContextDeploy {
  scope: string; // "global" | project dir
  agent: string;
  target: string; // the file made into a link
  canonical: string; // what it points at (realpath)
  mode: LinkMode;
  backup?: string; // where the pre-existing real file was moved, if it differed
}

export interface ContextManifest {
  version: 1;
  deploys: ContextDeploy[];
}

function loadManifest(p: string): ContextManifest {
  try {
    const m = JSON.parse(readFileSync(p, "utf8")) as ContextManifest;
    if (Array.isArray(m.deploys)) return { version: 1, deploys: m.deploys };
  } catch {
    /* none yet / malformed */
  }
  return { version: 1, deploys: [] };
}

function saveManifest(p: string, m: ContextManifest): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
}

/** Symlink a single file (not a dir): symlink → copy fallback (Windows w/o dev mode, cross-device). */
function linkFile(src: string, dest: string, mode: LinkMode): LinkMode {
  mkdirSync(dirname(dest), { recursive: true });
  if (mode === "copy") {
    cpSync(src, dest);
    return "copy";
  }
  try {
    symlinkSync(src, dest, "file");
    return "symlink";
  } catch {
    cpSync(src, dest);
    return "copy";
  }
}

function sameInode(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export interface ConvergeTarget {
  path: string;
  agent: string;
}

/**
 * Point each target file at `canonical` via symlink. Already-linked or byte-identical targets are
 * skipped; a differing real file is moved to `<path>.summa-bak-<ts>` (recorded in the manifest) and
 * replaced with a link. Returns counts + the list of backups made.
 */
export function convergeContext(opts: {
  canonical: string;
  scope: string;
  targets: ConvergeTarget[];
  manifestPath: string;
  mode?: LinkMode;
  stamp: number; // caller-supplied timestamp for backup naming (keeps this fn deterministic)
}): { linked: number; skipped: number; backedUp: string[]; errors: string[] } {
  const errors: string[] = [];
  const backedUp: string[] = [];
  let linked = 0;
  let skipped = 0;
  let canonReal: string;
  let canonContent: Buffer;
  try {
    canonReal = realpathSync(opts.canonical);
    canonContent = readFileSync(canonReal);
  } catch (e) {
    return { linked: 0, skipped: 0, backedUp: [], errors: [`canonical unreadable: ${String(e)}`] };
  }
  const m = loadManifest(opts.manifestPath);
  for (const tgt of opts.targets) {
    if (tgt.path === opts.canonical || sameInode(tgt.path, canonReal)) {
      skipped++; // it's the source, or already links to it
      continue;
    }
    try {
      let backup: string | undefined;
      if (existsSync(tgt.path)) {
        const isLink = (() => {
          try {
            return lstatSync(tgt.path).isSymbolicLink();
          } catch {
            return false;
          }
        })();
        const cur = isLink
          ? null
          : (() => {
              try {
                return readFileSync(tgt.path);
              } catch {
                return null;
              }
            })();
        // Empty or byte-identical real file → nothing worth preserving, just drop it. A divergent
        // real file (or any symlink pointing elsewhere) → move to a .summa-bak-<stamp> backup first.
        const disposable = cur !== null && (cur.length === 0 || Buffer.compare(cur, canonContent) === 0);
        if (disposable) {
          rmSync(tgt.path);
        } else {
          backup = `${tgt.path}.summa-bak-${opts.stamp}`;
          renameSync(tgt.path, backup);
          backedUp.push(backup);
        }
      }
      const mode = linkFile(canonReal, tgt.path, opts.mode ?? "symlink");
      m.deploys = m.deploys.filter((d) => d.target !== tgt.path); // replace any stale record
      m.deploys.push({ scope: opts.scope, agent: tgt.agent, target: tgt.path, canonical: canonReal, mode, backup });
      linked++;
    } catch (e) {
      errors.push(`${tgt.path}: ${String(e)}`);
    }
  }
  saveManifest(opts.manifestPath, m);
  return { linked, skipped, backedUp, errors };
}

/**
 * Undo one converged file: remove the link we created (never deletes a real file), and restore the
 * backed-up original if there was one. Prunes the manifest entry.
 */
export function unlinkContext(path: string, manifestPath: string): { removed: boolean; restored: boolean; error?: string } {
  const m = loadManifest(manifestPath);
  const rec = m.deploys.find((d) => d.target === path);
  // Only ever undo links agent-summa itself created (recorded in the manifest). A symlink the user
  // made by hand — e.g. their own ~/.codex/AGENTS.md → CLAUDE.md — is left strictly alone.
  if (!rec) return { removed: false, restored: false, error: "not-managed" };
  let isLink = false;
  try {
    isLink = lstatSync(path).isSymbolicLink();
  } catch {
    /* gone */
  }
  try {
    if (isLink) rmSync(path);
    let restored = false;
    if (rec?.backup && existsSync(rec.backup)) {
      renameSync(rec.backup, path); // put the user's original file back
      restored = true;
    }
    m.deploys = m.deploys.filter((d) => d.target !== path);
    saveManifest(manifestPath, m);
    return { removed: true, restored };
  } catch (e) {
    return { removed: false, restored: false, error: String(e) };
  }
}

/** Remove every context link agent-summa created (manifest-driven; real files are never touched). */
export function unlinkAllContext(manifestPath: string): { removed: number; restored: number } {
  const m = loadManifest(manifestPath);
  let removed = 0;
  let restored = 0;
  // Snapshot targets up front; unlinkContext re-loads + rewrites the manifest on each call.
  const targets = m.deploys.map((d) => d.target);
  for (const target of targets) {
    const r = unlinkContext(target, manifestPath);
    if (r.removed) removed++;
    if (r.restored) restored++;
  }
  return { removed, restored };
}

/** Read an instruction file for preview/diff (bounded). */
export function readContextFile(path: string, cap = 16000): { content: string; truncated: boolean } {
  try {
    const s = readFileSync(path, "utf8");
    return { content: s.length > cap ? `${s.slice(0, cap)}…` : s, truncated: s.length > cap };
  } catch {
    return { content: "", truncated: false };
  }
}
