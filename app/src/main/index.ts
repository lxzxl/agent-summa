import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyDesktopOverlay,
  applyOpencodeOverlay,
  builtinRegistry,
  convergeContext,
  globalContextScope,
  listMemoryStores,
  projectContextScope,
  readContextFile,
  readMemoryStore,
  unlinkContext,
  type DistTarget,
  fork,
  forkOutputDir,
  type ForkResult,
  listSubagents,
  openDb,
  removeSkillDir,
  scan,
  scanSkills,
  searchMessages,
  sessionStatus,
  type FsProbe,
  skillRoots,
  spreadSkill,
  uninstallSkills,
  type DB,
} from "@agent-summa/core";
import { app, BrowserWindow, clipboard, ipcMain, shell, utilityProcess, type UtilityProcess } from "electron";
import type {
  AgentConfigInfo,
  ConvergeResult,
  FtsProgress,
  MemoryStoreDetail,
  ProjectMemory,
  ResumeResult,
  ScanResult,
  SearchHit,
  SessionQuery,
  SessionRow,
  SkillDetail,
  SkillRow,
  SubagentsResult,
  TranscriptResult,
  UpdateInfo,
} from "@shared/ipc";

// GitHub repo for the update check (owner/name).
const REPO = "lxzxl/agent-summa";

/** Numeric major.minor.patch compare; ignores any pre-release suffix. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

let mainWindow: BrowserWindow | null = null;
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
let db: DB | undefined;

function ensureDb(): DB {
  if (!db) db = openDb(join(app.getPath("userData"), "index.db"), app.getVersion());
  return db;
}

function runScan(): ScanResult {
  const reg = builtinRegistry();
  const s = scan(ensureDb(), reg.installed());
  const o = applyDesktopOverlay(ensureDb());
  applyOpencodeOverlay(ensureDb()); // db-backed: indexes opencode sessions outside the file scanner
  const count = (ensureDb().prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number }).n;
  return { total: s.total, parsed: s.parsed, appCode: o.appCode, vmLocked: o.vmLocked, count };
}

let ftsWorker: UtilityProcess | null = null;

/**
 * Kick off message-content FTS indexing in a separate utilityProcess — the heavy work (full file
 * reads + synchronous better-sqlite3 writes) runs off-main so it never blocks the UI thread. Progress
 * messages are forwarded to the renderer. Guarded so at most one pass runs at a time; the worker
 * indexes only not-yet-indexed sessions (incremental), reports progress, then exits.
 */
function startFtsIndexing(): void {
  if (ftsWorker) return; // a pass is already running
  ftsWorker = utilityProcess.fork(join(__dirname, "fts-worker.cjs"), [join(app.getPath("userData"), "index.db"), app.getVersion()], {
    serviceName: "agent-summa-fts",
  });
  ftsWorker.on("message", (msg: FtsProgress) => {
    mainWindow?.webContents.send("fts:progress", msg);
    if (msg.type === "done" || msg.type === "error") {
      ftsWorker?.kill();
      ftsWorker = null;
    }
  });
  ftsWorker.on("exit", () => {
    ftsWorker = null;
  });
}

function querySessions(opts: SessionQuery): SessionRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.provider) {
    where.push("provider_slug = ?");
    params.push(opts.provider);
  }
  if (opts.source) {
    where.push("source = ?");
    params.push(opts.source);
  }
  if (opts.project) {
    where.push("project_root = ?");
    params.push(opts.project);
  }
  params.push(opts.limit ?? 500);
  const rows = ensureDb()
    .prepare(
      `SELECT session_path, session_id, provider_slug, source, title, last_prompt, project_root, workspace, model_name, rounds, started_at, ended_at, metadata_json
       FROM sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ended_at DESC LIMIT ?`,
    )
    .all(...params) as Array<Record<string, any>>;
  const now = Date.now();
  // Real fs probe for the status rule: dedupe existsSync across sessions sharing a workspace,
  // and treat a non-file sourcePath (e.g. db-backed `opencode:<id>`) as having no mtime.
  const wsExists = new Map<string, boolean>();
  const probe: FsProbe = {
    exists: (dir) => {
      let ok = wsExists.get(dir);
      if (ok === undefined) {
        ok = existsSync(dir);
        wsExists.set(dir, ok);
      }
      return ok;
    },
    mtimeMs: (path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    },
  };
  return rows.map((r) => {
    let meta: { interrupted?: boolean; subagents?: number; workflows?: number } = {};
    try {
      meta = JSON.parse(r.metadata_json || "{}");
    } catch {
      /* malformed metadata — ignore */
    }
    return {
      sessionPath: r.session_path,
      sessionId: r.session_id,
      provider: r.provider_slug,
      source: r.source,
      title: r.title,
      lastPrompt: r.last_prompt,
      project: r.project_root,
      workspace: r.workspace,
      model: r.model_name,
      rounds: r.rounds,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      status: sessionStatus(
        { source: r.source, endedAt: r.ended_at, rounds: r.rounds, workspace: r.workspace, sourcePath: r.session_path, interrupted: !!meta.interrupted },
        now,
        probe,
      ),
      subagents: meta.subagents ?? 0,
      workflows: meta.workflows ?? 0,
    };
  });
}

/** Single-quote a string for embedding in a POSIX shell command. */
const shq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

function launchResume(command: string, cwd?: string): boolean {
  try {
    if (isMac) {
      const full = (cwd ? `cd ${JSON.stringify(cwd)} && ` : "") + command;
      const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(full)}\nend tell`;
      spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    if (isWin) {
      // Open a new console that runs the command and stays open. spawn cwd → start's new window inherits it.
      spawn("cmd.exe", ["/c", "start", '""', "cmd", "/k", command], { cwd, detached: true, stdio: "ignore" }).unref();
      return true;
    }
    // Linux: best-effort across common terminals (each has different flags). UNTESTED on Linux.
    const inner = `${cwd ? `cd ${shq(cwd)} && ` : ""}${command}; exec bash`;
    const chain =
      `if command -v x-terminal-emulator >/dev/null 2>&1; then exec x-terminal-emulator -e bash -c ${shq(inner)}; ` +
      `elif command -v gnome-terminal >/dev/null 2>&1; then exec gnome-terminal -- bash -c ${shq(inner)}; ` +
      `elif command -v konsole >/dev/null 2>&1; then exec konsole -e bash -c ${shq(inner)}; ` +
      `elif command -v xterm >/dev/null 2>&1; then exec xterm -e bash -c ${shq(inner)}; ` +
      `else exit 1; fi`;
    spawn("sh", ["-c", chain], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

function registerIpc(): void {
  ipcMain.handle("scan", (): ScanResult => {
    const r = runScan();
    startFtsIndexing(); // index message content for any newly-discovered sessions (off-main)
    return r;
  });

  ipcMain.handle("agents", () => {
    const reg = builtinRegistry();
    const counts = new Map<string, number>();
    for (const r of ensureDb().prepare("SELECT provider_slug, COUNT(*) n FROM sessions GROUP BY provider_slug").all() as Array<{ provider_slug: string; n: number }>)
      counts.set(r.provider_slug, r.n);
    return reg.all().map((p) => ({ slug: p.slug, name: p.name, count: counts.get(p.slug) ?? 0 }));
  });

  ipcMain.handle("sessions", (_e, opts: SessionQuery = {}): SessionRow[] => querySessions(opts));

  ipcMain.handle("search", (_e, query: string, limit = 40): SearchHit[] =>
    searchMessages(ensureDb(), query, limit).map((h) => ({
      sessionPath: h.session_path,
      title: h.title,
      provider: h.provider_slug,
      project: h.project_root,
      snip: h.snip,
      via: h.via,
    })),
  );

  ipcMain.handle("skills", (): SkillRow[] =>
    scanSkills(builtinRegistry()).map((e) => ({ name: e.name, description: e.description, agents: e.agents, conflict: e.conflict })),
  );

  // Skill distribution: spread one skill into the agents missing it (symlink + manifest), and a
  // manifest-only uninstall that never touches the user's own skills.
  const skillManifest = (): string => join(app.getPath("home"), ".agent-summa", "skills-manifest.json");
  const skillTargets = (): DistTarget[] => {
    const out: DistTarget[] = [];
    for (const p of builtinRegistry().all()) {
      const d = p.skillsDir();
      if (d && existsSync(dirname(d))) out.push({ agent: p.slug, dir: d }); // only set-up agents
    }
    return out;
  };

  ipcMain.handle("skillTargets", (): string[] => skillTargets().map((t) => t.agent));

  ipcMain.handle("skillSpread", (_e, name: string): { linked: number; skipped: number; error?: string } => {
    const entry = scanSkills(builtinRegistry()).find((s) => s.name === name);
    const srcMd = entry?.dirs[0];
    if (!entry || !srcMd) return { linked: 0, skipped: 0, error: "not-found" };
    const have = new Set(entry.agents);
    const targets = skillTargets().filter((t) => !have.has(t.agent));
    return spreadSkill({ skillDir: dirname(srcMd), targets, manifestPath: skillManifest() });
  });

  ipcMain.handle("skillInstall", (_e, name: string, agentSlug: string): { linked: number; skipped: number; error?: string } => {
    const entry = scanSkills(builtinRegistry()).find((s) => s.name === name);
    const srcMd = entry?.dirs[0];
    const target = skillTargets().find((t) => t.agent === agentSlug);
    if (!entry || !srcMd) return { linked: 0, skipped: 0, error: "not-found" };
    if (!target) return { linked: 0, skipped: 0, error: "no-target" };
    return spreadSkill({ skillDir: dirname(srcMd), targets: [target], manifestPath: skillManifest() });
  });

  // Resolve the on-disk skill dir for (skill, agent): the entry's SKILL.md under that agent's root.
  const skillDirOf = (name: string, agentSlug: string): string | undefined => {
    const entry = scanSkills(builtinRegistry()).find((s) => s.name === name);
    const root = skillRoots(builtinRegistry()).find((r) => r.agent === agentSlug);
    if (!entry || !root) return undefined;
    const md = entry.dirs.find((d) => dirname(dirname(d)) === root.dir);
    return md ? dirname(md) : undefined;
  };

  ipcMain.handle("skillRemove", (_e, name: string, agentSlug: string): { removed: boolean; wasLink: boolean; error?: string } => {
    const dir = skillDirOf(name, agentSlug);
    if (!dir) return { removed: false, wasLink: false, error: "not-found" };
    return removeSkillDir(dir, skillManifest());
  });

  ipcMain.handle("skillRemoveAll", (_e, name: string): { removed: number } => {
    const entry = scanSkills(builtinRegistry()).find((s) => s.name === name);
    if (!entry) return { removed: 0 };
    let removed = 0;
    for (const md of entry.dirs) {
      if (removeSkillDir(dirname(md), skillManifest()).removed) removed++;
    }
    return { removed };
  });

  ipcMain.handle("skillDetail", (_e, name: string): SkillDetail | null => {
    const entry = scanSkills(builtinRegistry()).find((s) => s.name === name);
    if (!entry) return null;
    const roots = skillRoots(builtinRegistry());
    let managed = new Set<string>();
    try {
      const m = JSON.parse(readFileSync(skillManifest(), "utf8")) as { deploys?: { target: string }[] };
      managed = new Set((m.deploys ?? []).map((d) => d.target));
    } catch {
      /* no manifest yet */
    }
    const installs = entry.dirs.map((md) => {
      const path = dirname(md);
      const root = roots.find((r) => dirname(path) === r.dir);
      let type: "link" | "dir" = "dir";
      let target: string | null = null;
      try {
        if (lstatSync(path).isSymbolicLink()) {
          type = "link";
          target = readlinkSync(path);
        }
      } catch {
        /* vanished */
      }
      return { agent: root?.agent ?? "?", path, type, target, managed: managed.has(path) };
    });
    const real = installs.find((i) => i.type === "dir");
    const source = real?.path ?? installs.find((i) => i.target)?.target ?? null;
    const mdPath = real ? join(real.path, "SKILL.md") : entry.dirs[0];
    let skillMd = "";
    if (mdPath) {
      try {
        skillMd = readFileSync(mdPath, "utf8").slice(0, 8000);
      } catch {
        /* unreadable */
      }
    }
    return { name: entry.name, description: entry.description ?? null, installs, source, skillMd };
  });

  ipcMain.handle("skillUninstall", (): { removed: number } => uninstallSkills(skillManifest()));

  ipcMain.handle("transcript", (_e, sessionPath: string): TranscriptResult => {
    const empty = (reason: string): TranscriptResult => ({ ok: false, reason, total: 0, truncated: false, messages: [] });
    const row = ensureDb()
      .prepare("SELECT provider_slug, source FROM sessions WHERE session_path = ?")
      .get(sessionPath) as { provider_slug: string; source: string } | undefined;
    if (row?.source === "vm") return empty("vm-locked");
    // Indexed session → its provider; otherwise (e.g. a sub-agent transcript not in the
    // sessions table) resolve the owning provider by path and read the file directly.
    const p = row ? builtinRegistry().bySlug(row.provider_slug) : builtinRegistry().ownerOf(sessionPath);
    if (!p?.read) return empty(row ? "unsupported" : "not-found");
    try {
      // session_path == the physical file for all current (single-file) providers.
      const all = p.read(sessionPath).messages;
      const CAP = 10000; // renderer virtualizes; this is just a payload safety bound
      const TEXT = 8000;
      const slice = all.slice(0, CAP);
      return {
        ok: true,
        reason: "ok",
        total: all.length,
        truncated: all.length > CAP,
        messages: slice.map((m) => ({
          idx: m.idx,
          role: m.role,
          text: m.content.length > TEXT ? `${m.content.slice(0, TEXT)}…` : m.content,
          tools: m.toolCalls.map((t) => t.name).filter(Boolean),
          ts: m.timestamp ?? null,
        })),
      };
    } catch (e) {
      return empty(String(e));
    }
  });

  ipcMain.handle("subagents", (_e, sessionPath: string): SubagentsResult => {
    const refs = listSubagents(sessionPath);
    const CAP = 120;
    const cc = builtinRegistry().bySlug("claude-code");
    const items = refs.slice(0, CAP).map((ref) => {
      let label: string | null = null;
      let rounds = 0;
      let startedAt: number | null = null;
      let endedAt: number | null = null;
      try {
        const h = cc!.readHead(ref.path);
        label = h.title ?? h.lastPrompt ?? null;
        rounds = h.rounds;
        startedAt = h.startedAt ?? null;
        endedAt = h.endedAt ?? null;
      } catch {
        /* unreadable child — keep nulls */
      }
      return { path: ref.path, kind: ref.kind, workflowId: ref.workflowId, label, rounds, startedAt, endedAt };
    });
    // Stable order: workflows grouped together, then by start time.
    items.sort((a, b) => (a.workflowId ?? "").localeCompare(b.workflowId ?? "") || (a.startedAt ?? 0) - (b.startedAt ?? 0));
    return { total: refs.length, truncated: refs.length > CAP, items };
  });

  ipcMain.handle("resume", (_e, s: { sessionId: string; provider: string; cwd?: string }): ResumeResult => {
    const p = builtinRegistry().bySlug(s.provider);
    const cmd = p?.resumeCmd(s.sessionId, "", s.cwd);
    if (!cmd || cmd.displayOnly) return { ok: false, command: cmd ? [cmd.program, ...cmd.args].join(" ") : "", launched: false };
    const command = [cmd.program, ...cmd.args].join(" ");
    return { ok: true, command, launched: launchResume(command, cmd.cwd) };
  });

  // Update check: compare the running version to the latest GitHub release. We surface a download
  // link rather than auto-installing (the build is unsigned). The app's only outbound call.
  // Uses the releases/latest *web redirect*, not the REST API: the API's unauthenticated limit
  // (60/hr per IP) is easily exhausted behind shared/NAT egress IPs, whereas the web endpoint
  // isn't rate-limited and 302-redirects to the newest tag — so we read the tag from the final URL.
  ipcMain.handle("checkForUpdate", async (): Promise<UpdateInfo> => {
    const current = app.getVersion();
    const releases = `https://github.com/${REPO}/releases`;
    const fail = (reason: string): UpdateInfo => ({ ok: false, current, latest: null, hasUpdate: false, url: null, reason });
    try {
      const res = await fetch(`${releases}/latest`, { redirect: "follow", signal: AbortSignal.timeout(8000) });
      if (!res.ok) return fail(`HTTP ${res.status}`);
      const m = /\/releases\/tag\/([^/?#]+)/.exec(res.url);
      if (!m) return { ok: true, current, latest: null, hasUpdate: false, url: releases }; // no releases published yet
      const latest = decodeURIComponent(m[1]).replace(/^v/, "");
      return { ok: true, current, latest, hasUpdate: isNewer(latest, current), url: res.url };
    } catch (e) {
      return fail(String(e));
    }
  });

  // Open a URL in the default browser (release download page). https only — never other schemes.
  ipcMain.handle("openExternal", async (_e, url: string): Promise<void> => {
    if (/^https:\/\//i.test(url)) await shell.openExternal(url);
  });

  // The resume command as text (no launch) — for the copy buttons.
  ipcMain.handle("resumeCommand", (_e, s: { sessionId: string; provider: string; cwd?: string }) => {
    const cmd = builtinRegistry().bySlug(s.provider)?.resumeCmd(s.sessionId, "", s.cwd);
    if (!cmd) return { command: "", cwd: null, displayOnly: false };
    return { command: [cmd.program, ...cmd.args].join(" "), cwd: cmd.cwd ?? null, displayOnly: !!cmd.displayOnly };
  });

  ipcMain.handle("copy", (_e, text: string): void => clipboard.writeText(text));

  // Cross-agent fork: write the carried context into the TARGET agent's real session store
  // (so its `resume` actually finds it), then re-index so it appears in the list.
  ipcMain.handle("fork", (_e, s: { sessionPath: string; targetSlug: string }): ForkResult | { error: string } => {
    try {
      const home = app.getPath("home");
      const row = ensureDb().prepare("SELECT workspace FROM sessions WHERE session_path = ?").get(s.sessionPath) as
        | { workspace: string | null }
        | undefined;
      const cwd = row?.workspace ?? home; // the target store is keyed by the source's cwd
      const outDir = forkOutputDir(s.targetSlug, home, cwd);
      if (!outDir) return { error: `unknown fork target: ${s.targetSlug}` };
      const res = fork(builtinRegistry(), s.sessionPath, s.targetSlug, outDir);
      runScan();
      return res;
    } catch (e) {
      return { error: String(e) };
    }
  });

  // ── Memory: cross-agent instruction-file convergence (3a) ──────────────────
  const contextManifest = (): string => join(app.getPath("home"), ".agent-summa", "context-manifest.json");

  ipcMain.handle("contextRead", (_e, path: string) => readContextFile(path));
  ipcMain.handle(
    "contextConverge",
    (_e, arg: { scope: string; canonical: string; targets: { path: string; agent: string }[] }): ConvergeResult =>
      convergeContext({ canonical: arg.canonical, scope: arg.scope, targets: arg.targets, manifestPath: contextManifest(), stamp: Date.now() }),
  );
  ipcMain.handle("contextUnlink", (_e, path: string) => unlinkContext(path, contextManifest()));

  // ── Memory: learned auto-fact stores (3b, read-only) ───────────────────────
  ipcMain.handle("memoryStoreRead", (_e, path: string): MemoryStoreDetail => readMemoryStore(path));

  const ctxManaged = (): Set<string> => {
    try {
      const m = JSON.parse(readFileSync(contextManifest(), "utf8")) as { deploys?: { target: string }[] };
      return new Set((m.deploys ?? []).map((d) => d.target));
    } catch {
      return new Set();
    }
  };
  const encodeCwd = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, "-");

  // A session's project memory: instruction-file matrix (always built so missing files can be created)
  // + the learned store for that cwd (Claude memory/ is keyed by cwd → workspace, falling back to project).
  ipcMain.handle("projectMemory", (_e, project: string | null, workspace: string | null): ProjectMemory => {
    const dir = project || workspace;
    const managed = ctxManaged();
    let scope: ProjectMemory["scope"] = null;
    if (dir) {
      const sc = projectContextScope(dir, true);
      if (sc) scope = { ...sc, slots: sc.slots.map((s) => ({ ...s, managed: managed.has(s.path) })) };
    }
    let store: ProjectMemory["store"] = null;
    const keys = [workspace, project].filter(Boolean).map((d) => encodeCwd(d as string));
    if (keys.length) {
      const s = listMemoryStores().find((st) => keys.includes(st.key));
      if (s) store = { path: s.path, label: dir ?? s.key, factCount: s.factCount };
    }
    return { scope, store };
  });

  // Per-agent config card: install/version/home/counts + this agent's GLOBAL instruction slot.
  ipcMain.handle("agentConfig", (_e, slug: string): AgentConfigInfo => {
    const reg = builtinRegistry();
    const p = reg.bySlug(slug);
    const det = p?.detect();
    const g = globalContextScope();
    const managed = ctxManaged();
    const raw = g.slots.find((s) => s.agents.includes(slug)) ?? null;
    const globalSlot = raw ? { ...raw, managed: managed.has(raw.path) } : null;
    const sessions = (ensureDb().prepare("SELECT COUNT(*) n FROM sessions WHERE provider_slug = ?").get(slug) as { n: number }).n;
    const skills = scanSkills(reg).filter((e) => e.agents.includes(slug)).length;
    return {
      slug,
      name: p?.name ?? slug,
      installed: det?.installed ?? false,
      version: det?.version ?? null,
      home: globalSlot ? dirname(globalSlot.path) : "",
      sessions,
      skills,
      globalSlot,
      canonical: g.canonical ?? null,
    };
  });
}

function createWindow(): void {
  const iconPath = join(app.getAppPath(), "build", "icon.png");
  const hasDevIcon = existsSync(iconPath); // dev only; packaged builds use the electron-builder bundle icon
  if (isMac && hasDevIcon) app.dock?.setIcon(iconPath);
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    title: "agent-summa",
    backgroundColor: "#08090A",
    ...(hasDevIcon && !isMac && { icon: iconPath }),
    ...(isMac && { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 14 }, roundedCorners: true }),
    ...(isWin && { titleBarStyle: "hidden" as const, titleBarOverlay: { color: "#0C0D0F", symbolColor: "#8B989B", height: 38 } }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  ensureDb();
  try {
    runScan();
  } catch (e) {
    console.error("[agent-summa] initial scan failed:", e);
  }
  registerIpc();
  createWindow();
  startFtsIndexing(); // build the message-content FTS index off-main (search needs it)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
