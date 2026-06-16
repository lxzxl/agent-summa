import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function home(): string {
  return homedir();
}

export function expandTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Files directly inside `dir` (depth 1) whose name ends with `ext`. */
export function listFilesShallow(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(ext)) continue;
    const p = join(dir, name);
    try {
      if (statSync(p).isFile()) out.push(p);
    } catch {
      /* race / perms */
    }
  }
  return out;
}

/** Recursively collect files under `root` whose basename matches `match`. */
export function walkFiles(root: string, match: (name: string) => boolean, maxDepth = 8): string[] {
  const out: string[] = [];
  const rec = (dir: string, depth: number): void => {
    if (depth > maxDepth || !existsSync(dir)) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) rec(p, depth + 1);
      else if (e.isFile() && match(e.name)) out.push(p);
    }
  };
  rec(root, 0);
  return out;
}

export function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) out.push(p);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function pushJsonLines(s: string, recs: unknown[]): void {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      recs.push(JSON.parse(t));
    } catch {
      /* skip malformed / partial line */
    }
  }
}

/**
 * Bounded read of an append-only JSONL file: returns parsed records from the head
 * (and tail, for large files) without streaming the whole thing. Small files are
 * read in full; files larger than 2*bytes return head + tail only (counts approximate).
 */
export function readHeadTailRecords(path: string, bytes = 65536): unknown[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const recs: unknown[] = [];
    const headLen = Math.min(bytes, size);
    const head = Buffer.alloc(headLen);
    readSync(fd, head, 0, headLen, 0);
    pushJsonLines(head.toString("utf8"), recs);

    if (size > headLen && size <= bytes * 2) {
      const restLen = size - headLen;
      const rest = Buffer.alloc(restLen);
      readSync(fd, rest, 0, restLen, headLen);
      pushJsonLines(rest.toString("utf8"), recs);
    } else if (size > bytes * 2) {
      const tail = Buffer.alloc(bytes);
      readSync(fd, tail, 0, bytes, size - bytes);
      const s = tail.toString("utf8");
      const nl = s.indexOf("\n"); // drop partial first line
      pushJsonLines(nl >= 0 ? s.slice(nl + 1) : s, recs);
    }
    return recs;
  } finally {
    closeSync(fd);
  }
}

/** Parse every JSONL record in a file (best-effort). For full read() / transcript parsing. */
export function readAllRecords(path: string): unknown[] {
  const recs: unknown[] = [];
  pushJsonLines(readFileSync(path, "utf8"), recs);
  return recs;
}

const gitCache = new Map<string, string | undefined>();

/** Nearest ancestor dir containing `.git`; falls back to `cwd` itself so grouping still works. */
export function gitRoot(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (gitCache.has(cwd)) return gitCache.get(cwd);
  let d = cwd;
  while (d && d.length > 1) {
    if (existsSync(join(d, ".git"))) {
      gitCache.set(cwd, d);
      return d;
    }
    const nd = dirname(d);
    if (nd === d) break;
    d = nd;
  }
  gitCache.set(cwd, cwd);
  return cwd;
}

export interface FileStat {
  mtime: number;
  size: number;
}

export function statFile(path: string): FileStat | undefined {
  try {
    const s = statSync(path);
    return { mtime: Math.round(s.mtimeMs), size: s.size };
  } catch {
    return undefined;
  }
}
