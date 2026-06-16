# agent-summa · core design draft (v0.2, TypeScript)

> 2026-06-13 · Corresponds to PRD §7. The data model/interfaces are a **clean-room rewrite**, mirroring only public format knowledge and the *architectural patterns* of permissively-licensed projects; no restricted code was copied.
>
> **Tech stack**: Electron + TypeScript (`better-sqlite3`). `core` is a **framework-agnostic pure-TS package** (does not import Electron), decoupled from the shell → if size/performance becomes a real problem, we can swap to a Tauri shell (frontend TS untouched) or move the hot scanner to a Rust sidecar/napi. Rust/Tauri is a **fallback**, not the current choice.

---

## 0. Build vs Reuse conclusion: write our own (do not reuse its Rust session-reader crate)

**Do not vendor or depend on the prior-art Rust session-reader crate.** Two independent reasons:

1. **License flatly forbids it (decisive)**: that crate's LICENSE is *"MIT License (with OpenAI/Anthropic Rider)"* (`license-file`, no SPDX `license=` → non-OSI, non-standard). The Rider defines "Restricted Parties" as OpenAI, Anthropic and their affiliates, **plus "any person/entity acting on their behalf, for their benefit, or under their direction"**, declares that "notwithstanding any other term of this license, no rights are granted to a Restricted Party", and explicitly forbids inclusion in "a dataset, training corpus, evaluation harness, or any ML pipeline". Breach triggers automatic termination + injunction + attorney's fees → **legally unusable**. (Note: it is a Rust crate, so it would never become an npm dependency of ours anyway; but the discipline still stands — do not copy its source logic.)
2. **We don't need it anyway**: the valuable part (provider-agnostic session structure + read/write interfaces + static registry) is small, generic, and can be rewritten from public on-disk format knowledge.

**Permissively-licensed vehicles whose *patterns* we can safely mirror (port to TS, not copy source)**:
- **a reference Electron desktop app (prior art)** (Apache-2.0, Rust): `read_head_tail` bounded IO, `(path,size,mtime)+version stamp` cache, 3s single-flight, multi-pass merge normalization, watcher+debounce, Claude desktop join.
- **the DB layer of a prior session-archive prototype (prior art)** (README declares MIT, Rust): `scan_state` trust-count incremental, FTS5 external-content, corrupt-DB self-healing, version-downgrade guard, linear integer migrations.

**Operational guardrails**:
- CI runs **license-checker** (npm), allowlist=MIT/Apache-2.0/BSD/ISC/Unicode/Zlib, **fail build** on unknown license (scans `node_modules`).
- `ATTRIBUTION.md` credits the pattern sources: the reference Electron desktop app (Apache-2.0 NOTICE) and the prior session-archive prototype (MIT).
- **Do not copy that crate's source/tests/fixtures**; fixtures are generated from real local sessions.

---

## 1. Canonical IR (`core/src/model.ts`)

```typescript
// Framework-agnostic canonical IR. The whole app's "Rosetta Stone". Does not import Electron/any shell.

export type MessageRole = "user" | "assistant" | "tool" | "system" | "other";
// When role is "other", the raw role string goes into message.extra.rawRole (aligns with the DB CHECK constraint)

/** Logical source layer: UI badge + dedup namespace. The same provider can expose the same session through multiple layers */
export type SessionSource = "cli" | "app-code" | "app-web" | "db-backed";

export type TitleSource = "custom" | "ai" | "slug" | "summary" | "prompt" | "none";

export interface ToolCall {
  id?: string;              // Claude tool_use.id / Codex call_id
  name: string;
  arguments: unknown;       // Already JSON-parsed (Codex's arguments is a string, JSON.parse first; on failure keep raw in extra)
}

export interface ToolResult {
  callId?: string;          // Links back to ToolCall.id
  content: string;
  isError: boolean;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  contextTokens: number;    // Single-turn peak input footprint (context-window proxy)
  costUsd: number;
  model?: string;
}

export interface CanonicalMessage {
  idx: number;              // 0-based ordinal after linearization
  role: MessageRole;
  content: string;          // Flattened plain text (text blocks concatenated; thinking goes into extra)
  timestamp?: number;       // epoch millis
  author?: string;          // model name / "user" / "reasoning"
  nativeId?: string;        // provider-native message id (Claude uuid, etc.)
  parentId?: string;        // DAG threading (Claude parentUuid); undefined if linear
  isSidechain: boolean;     // sub-agent/sidechain (Claude isSidechain) → collapsible in UI
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  extra: unknown;           // provider-specific fields preserved as-is (thinking, raw payload, rawRole)
}

/** provider-agnostic single-session representation */
export interface CanonicalSession {
  sessionId: string;        // provider-assigned id (Claude/Codex uuid, Gemini sessionId, opencode row id)
  providerSlug: string;     // provider that owns this session, e.g. "claude-code"
  source: SessionSource;
  workspace?: string;       // decoded real cwd (not the encoded directory key)
  title?: string;
  lastPrompt?: string;      // most recent user input, independent of title, never merged in
  summary?: string;         // /compact-style summary
  titleSource: TitleSource;
  startedAt?: number;       // epoch millis
  endedAt?: number;         // epoch millis (== last activity, the sort key)
  messages: CanonicalMessage[];  // already linearized by parent chain
  rounds: number;           // user-initiated rounds
  messageCount: number;     // total transcript entries (>= rounds)
  usage?: SessionUsage;
  modelName?: string;
  sourcePath: string;       // logical session path (app-wide unique key); for db-backed, a virtual "<db>/<id>"
  backingPath: string;      // the physical file actually stat'd (== sourcePath except for db-backed)
  metadata: unknown;        // provider-native fields (round-trip fidelity)
}

/** Lightweight metadata obtainable from a bounded head+tail read, populated ahead of full parse for the list (the reference app's read_head_tail) */
export interface SessionHead {
  sessionId: string;
  title?: string;
  lastPrompt?: string;
  summary?: string;
  workspace?: string;
  titleSource: TitleSource;
  rounds: number;           // approximate when file > 2*64KiB
  messageCount: number;     // approximate for large files
  modelName?: string;
  startedAt?: number;
  endedAt?: number;
}

// helpers (clean-room): flattenContent / parseTimestamp / normalizeRole
//   / truncateTitle / reindexMessages
```

---

## 2. Provider interface + registry (`core/src/provider.ts`)

IO methods return `Promise`. TS interfaces have no default methods, so the default directory traversal lives in a `BaseProvider` abstract class or a `walkSessionRoots(p)` helper; db-backed providers (opencode/cursor) override `list()`.

```typescript
import type { CanonicalSession, SessionHead } from "./model";

export interface DetectionResult {
  installed: boolean;
  version?: string;
  evidence: string[];
}

export interface WriteOptions { force: boolean } // P1 fork; write operations create a .bak backup

/** Structured command for resume (program+args, never a concatenated shell string) → injection-proof; the UI can also show a copyable string */
export interface ResumeCommand {
  program: string;          // "claude"
  args: string[];           // ["--resume", "<id>"]
  cwd?: string;             // launch from the session workspace
}

export interface WrittenSession {
  paths: string[];
  sessionId: string;
  resumeCommand: ResumeCommand;
  backupPath?: string;
}

/** One implementation per agent */
export interface Provider {
  readonly name: string;       // "Claude Code"
  readonly slug: string;       // "claude-code" (stable kebab-case, == DB provider_slug)
  readonly cliAlias: string;   // "cc"

  detect(): Promise<DetectionResult>;       // probe installation: PATH binary + config directory
  sessionRoots(): string[];                 // root directories to traverse (empty if not installed)
  skillsDir(): string | undefined;          // used by the skills manager; undefined if there is no skill concept

  list(): Promise<string[]>;                // default traverses roots; db-backed overrides (one file expands to many logical sessions)
  ownsPath(path: string): boolean;          // extension + content-signature sniffing

  readHead(path: string): Promise<SessionHead>;        // bounded head/tail, never reads the full file
  read(path: string): Promise<CanonicalSession>;       // full parse (detail/search/fork)

  write?(session: CanonicalSession, opts: WriteOptions): Promise<WrittenSession>; // P1 fork (optional)

  // logicalPath lets a db-backed provider resolve the db; a provider with no id-resume degrades to "open app/copy command"
  resumeCmd(sessionId: string, logicalPath: string, workspace?: string): ResumeCommand;
}

/** Static registry (array, deterministic, no magic auto-registration — mirrors the prior-art hardcoded approach) */
export class ProviderRegistry {
  constructor(private providers: Provider[]) {}

  static withBuiltins(): ProviderRegistry {
    return new ProviderRegistry([
      new ClaudeCodeProvider(),
      new CodexProvider(),
      new GeminiProvider(),
      new QwenProvider(),       // gemini-cli fork, ~/.qwen, reuses GeminiLikeReader
      new OpenCodeProvider(),
      new CursorProvider(),     // experimental, P1
    ]);
  }

  all(): Provider[] { return this.providers; }
  async installed(): Promise<Provider[]> {
    const flags = await Promise.all(this.providers.map(p => p.detect()));
    return this.providers.filter((_, i) => flags[i].installed);
  }
  bySlug(slug: string): Provider | undefined { return this.providers.find(p => p.slug === slug); }
  byAlias(alias: string): Provider | undefined {
    const canon = normalizeAlias(alias); // "claude"->"claude-code", "gemini-cli"->"gemini" ...
    return this.providers.find(p => p.cliAlias === canon || p.slug === canon);
  }
  ownerOf(path: string): Provider | undefined { return this.providers.find(p => p.ownsPath(path)); }
}
```

Key `resumeCmd` contract points: opencode launches bare, cursor has no id-addressable resume → return an "open app"-style `ResumeCommand` or mark as display-only, and the UI degrades accordingly.

---

## 3. Index SQLite schema (`core/src/index/schema.sql`)

Uses **`better-sqlite3`** (synchronous, C++ bindings, FTS5 bundled). Open-DB PRAGMA (`db.pragma(...)`, mirrors the prior-art prototype): `journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000; foreign_keys=ON; mmap_size=256MiB; temp_store=MEMORY`. DB lives in `app.getPath('userData')`.

```sql
CREATE TABLE schema_meta ( id INTEGER PRIMARY KEY CHECK(id=1),
  schema_version INTEGER NOT NULL, app_version TEXT NOT NULL, updated_at TEXT NOT NULL );

-- one row = one logical session (1-file provider: logical==backing; opencode: virtual path)
CREATE TABLE sessions (
  session_path TEXT PRIMARY KEY,            -- logical, app-wide unique key
  session_id TEXT NOT NULL, provider_slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cli' CHECK(source IN('cli','app-code','app-web','db-backed')),
  workspace TEXT, project_root TEXT,        -- workspace=real cwd; project_root=git root (falls back to cwd), the grouping/filter key
  title TEXT, title_source TEXT, last_prompt TEXT, summary TEXT, model_name TEXT,
  rounds INTEGER NOT NULL DEFAULT 0, message_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER, ended_at INTEGER,     -- epoch millis; ended_at is the sort key
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER, context_tokens INTEGER, cost_usd REAL,
  parent_session_path TEXT,                 -- fork lineage (P1)
  cli_session_id TEXT,                      -- Claude desktop local_*.json join key
  metadata_json TEXT NOT NULL DEFAULT '{}', indexed_at TEXT NOT NULL );
CREATE INDEX idx_sessions_ended_at ON sessions(ended_at DESC);
CREATE INDEX idx_sessions_workspace ON sessions(workspace);
CREATE INDEX idx_sessions_project_root ON sessions(project_root);
CREATE INDEX idx_sessions_provider ON sessions(provider_slug);

CREATE TABLE message_entries (
  rowid_pk INTEGER PRIMARY KEY,             -- explicit, stable FTS content_rowid
  session_path TEXT NOT NULL, idx INTEGER NOT NULL, native_id TEXT,
  role TEXT NOT NULL CHECK(role IN('user','assistant','tool','system','other')),
  source_type TEXT NOT NULL DEFAULT 'text'
    CHECK(source_type IN('text','thinking','tool_call','tool_result','summary')),
  content TEXT NOT NULL, search_text TEXT NOT NULL DEFAULT '',
  timestamp INTEGER, is_sidechain INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(session_path) REFERENCES sessions(session_path) ON DELETE CASCADE );
CREATE INDEX idx_me_session_idx ON message_entries(session_path, idx);

-- FTS5 external-content (prior-art prototype pattern): only tokenize search_text; maintained via 'rebuild'/'optimize', no triggers
CREATE VIRTUAL TABLE message_fts USING fts5(
  session_path UNINDEXED, role UNINDEXED, source_type UNINDEXED, search_text,
  content='message_entries', content_rowid='rowid_pk', tokenize='unicode61' );

-- incremental scan bookkeeping (prior-art scan_state + trust count)
CREATE TABLE scan_state (
  session_path TEXT PRIMARY KEY, backing_path TEXT NOT NULL, provider_slug TEXT NOT NULL,
  file_modified INTEGER NOT NULL, file_size INTEGER NOT NULL, last_scanned_at INTEGER NOT NULL,
  last_parse_status TEXT NOT NULL,          -- ok|error|partial
  read_offset INTEGER NOT NULL DEFAULT 0,   -- append-only tail read offset
  append_trust_count INTEGER NOT NULL DEFAULT 0 );  -- >=3 → trust tail read

-- app-owned metadata (survives reindex)
CREATE TABLE favorites ( session_path TEXT PRIMARY KEY, created_at TEXT NOT NULL );
CREATE TABLE tags ( id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE );
CREATE TABLE session_tags ( session_path TEXT NOT NULL, tag_id INTEGER NOT NULL,
  PRIMARY KEY(session_path, tag_id), FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE );
```

**Incremental classification rule** (scanner): a backing file needs re-parsing if and only if — no sessions row / no scan_state row / stat failed / backing_path changed / mtime changed / size changed / last_parse_status≠ok; otherwise skip.
**watcher fast path**: if both mtime and size are unchanged → skip; otherwise if `trust>=3 && read_offset>0 && size>=read_offset` → seek and parse only the new bytes (Node `fs.read` with position); `size<read_offset` → truncated/rewritten → full re-parse; after a clean full parse `trust=3, read_offset=size`; each successful tail read does trust+1. A newly seeded row gets `read_offset=size, trust=3`, and `ON CONFLICT` leaves offset/trust untouched.
**The index is a disposable cache**: a global cache-version stamp; corrupt DB → copy to `.corrupted.<ts>` → delete → rebuild; `schema_meta` serves as the downgrade guard + linear integer migrations.

**Project grouping (`project_root`)**: at index time (in the index layer, not the framework-agnostic `model.ts` — this touches fs), walk up from `workspace` (real cwd, taken from the file's own field, not the encoded directory) to the nearest `.git` → `project_root` (falls back to cwd); **cache per directory** to avoid repeated stat. The sidebar Projects filter, `Group by project`, and stats all use it:
```sql
SELECT project_root, COUNT(*) AS n, MAX(ended_at) AS last
FROM sessions GROUP BY project_root ORDER BY last DESC;
```
- **Natural cross-agent aggregation** (measured locally: `web-api` spans cli/desktop/codex with 87 sessions total; 572 sessions → 34 projects) — a concrete realization of the product's differentiator.
- Pitfall ①: **basename collisions**: use the **full `project_root` path** as the grouping key; if the display name collides (locally there are two distinct git roots both named `frontend-ui`), append the parent directory to disambiguate.
- Pitfall ②: **no cwd** (sub-agent/workflow/VM, 80 measured) → `project_root=NULL`, grouped under "Unknown project".
- cwd already deleted on disk → no `.git` found → falls back to the cwd string and groups normally.

---

## 4. Per-agent paths + mapping + resume

> env overrides `CLAUDE_HOME` etc.; on Windows use `%APPDATA%`/`%USERPROFILE%` in place of `~`.

| provider | session_roots | owns sniff | record → canonical | resume | skills_dir |
|---|---|---|---|---|---|
| **claude-code** | `~/.claude/projects/<encCwd>/<sid>.jsonl`; desktop metadata `…/Claude/claude-code-sessions/<dev>/<acct>/local_*.json`; web synthetic `-claude-ai` | `.jsonl`, line has top-level `sessionId`+`type∈{user,assistant,…}` | filename==sid; role=message.role; content=concatenated text blocks (thinking→extra); tool_calls=assistant `tool_use` (id/name/input); tool_results=subsequent user `tool_result` matched by tool_use_id, preferring top-level `toolUseResult`; native_id=uuid, parent_id=parentUuid (**linearized by DAG, not line order**), is_sidechain=isSidechain; ts=top-level timestamp; usage=message.usage; cwd=`cwd` | `claude --resume <id>` (cwd=workspace) | `~/.claude/skills` (+`<ws>/.claude/skills`) |
| **codex** | `~/.codex/sessions/Y/M/D/rollout-*.jsonl`; index `session_index.jsonl`; `archived_sessions/` | first line `{type:"session_meta"}` or line has `{type,payload}` envelope | id=session_meta.payload.id (falls back to filename uuid); **true source=`type:response_item`, skip `event_msg` (only take token_count→usage)**; content=concatenated `content[].text` (input_text/output_text); `function_call/custom_tool_call`→ToolCall (arguments **needs JSON.parse on the string**); `function_call_output` matched by call_id→ToolResult; `reasoning`→extra; title via session_index.thread_name; cwd=session_meta.cwd | `codex resume <id>` (cwd=ws) | n/a |
| **gemini** | `~/.gemini/tmp/<hash>/chats/<sid>.jsonl` (sub-agents nested; legacy logs.json is prompt-only) | under `.gemini/tmp/*/chats/`; **single JSON document=ConversationRecord with `messages[]` (not line-by-line)** | role from `type` (gemini→Assistant); content is a genai PartListUnion: `{text}`→content, `{functionCall}`→ToolCall, `{functionResponse}`→ToolResult; `type:gemini` adds toolCalls/thoughts (→extra)/tokens (→usage)/model; native_id=MessageRecord.id; kind=subagent→is_sidechain | `gemini --resume <id>` (cwd=ws) | `~/.gemini/commands` |
| **qwen** | `~/.qwen/tmp/<hash>/chats/<sid>.jsonl` (gemini-cli FORK, identical layout) | same as gemini, under `~/.qwen` | **identical to Gemini** (shares `GeminiLikeReader`, parameterized on home+slug) | `qwen --resume <id>` | `~/.qwen/commands` |
| **opencode** | DB: `<data>/opencode.db` (`~/.local/share/opencode`/project `.opencode/`/XDG) | sqlite named `opencode.db` | `list()` expands one db into many virtual paths (better-sqlite3 queries the session rows); message/parts tables→content+tool_*; **backing_path=`.db` (stat it), source_path=virtual**; on rescan, expand + reconcile deletions | `opencode` (bare, has its own picker, no id parameter) | `<config>/opencode` |
| **cursor** | `state.vscdb` sqlite (`…/Cursor/User/…`) | `.vscdb` signature | DB-backed, same as opencode; **P1/stretch — schema is undocumented and changes across versions, marked experimental** | `cursor` (opens app, no reliable CLI resume) → possibly display-only | n/a |

**Cross-source join (Claude desktop→CLI, mirrors the reference app's pass3)**: walk `local_*.json`, read `cliSessionId`+`cwd` (skip if missing). Locate the owning project: (a) already-seen `(pid,sid==cliSessionId)`; otherwise (b) fs-scan `~/.claude/projects/*` for the directory containing `<cliSessionId>.jsonl`; otherwise (c) last resort `encodeProjectPath(cwd)` (because Claude's non-ASCII path encoding is irreversible). If already seen, only upgrade the title from the json when the CLI has none + `source=app-code`; otherwise read rounds/count from the CLI jsonl, take title/ts from the json, and insert an app-code row. Finally dedup by `"<slug>:<sid>"` (opencode/codex ids may collide with Claude uuids): on conflict take the one with more rounds / let the app source upgrade the cli one, with title/summary falling back via `??` so nothing is lost.
**encoded-cwd rule**: after resolving the absolute path → replace every non-alphanumeric character with `-` (including separators and dots). **The reverse is lossy, don't trust it**; the real cwd is taken from the file's own `cwd` field, and the encoding is only used to "locate the directory".

---

## 5. Open risks

1. **Clean-room discipline**: that crate is rider-restricted, so do not copy its source/tests/fixtures; rely on CI **license-checker** SPDX allowlist as the gate + `ATTRIBUTION.md` crediting only the *patterns* of the prior-art projects.
2. **The reference Electron app is Apache-2.0** (patent grant + NOTICE obligation), and **the prior session-archive prototype's code "declares MIT in the README but has no LICENSE file"** (weak provenance). We port the *patterns* to TS, not the source code; if we ever truly need the literal logic, the prototype's missing LICENSE is a real risk → rewrite from the docs.
3. **Claude parentUuid DAG ≠ line order**: a session has branches (sidechain/subagent/edits); linearizing purely by line order is wrong for forked transcripts, and a true topological traversal + sidechain collapse is needed. A head/tail read **cannot** reconstruct a large file's DAG → approximate counts in the list, full parse only in the detail view.
4. **Codex arguments=JSON string + call/output far apart across lines**: `function_call.arguments` must be `JSON.parse`d (on failure keep raw in extra); a call and its output may be far apart, and a tail-only incremental read may see the output while its call is below read_offset → pairing must tolerate orphans across incremental boundaries (buffer those not matched to a call_id, or finally pair on the next full parse).
5. **db-backed (opencode/cursor) breaks the "1 file = 1 session" assumption**: use backing_path indirection (one physical file → many logical paths) + rescan expansion with reconciled deletions; but (a) sqlite cannot do byte-offset/append-trust (mtime/size change wholesale), so any change to opencode/cursor forces a full re-expansion; (b) Cursor's `state.vscdb` schema is undocumented and changes across versions → high maintenance, marked experimental/P1.
6. **append-trust correctness**: trusting tail reads assumes strict append-only; Claude/Codex append a summary/last-prompt again on resume; `trust>=3 + size-shrink fallback` handles truncation, but an in-place rewrite at the same size would be missed → keep the cheap mtime+size full classification as the outer gate, with tail reads as an optimization only.
7. **Windows paths + encoding alignment**: encoded-cwd uses separators; Claude's lossy non-ASCII encoding (CJK→dash) is irreversible, so join fallback (c) may bucket wrong; `%APPDATA%` vs `%LOCALAPPDATA%`; case-insensitive FS → needs a per-OS path table + tests with non-ASCII workspace names (users often use Chinese).
8. **FTS5 + CJK**: `unicode61` tokenizes Chinese poorly (users use Chinese) → consider the `trigram` tokenizer or a CJK-aware approach; storing `search_text` separately doubles the text → decide whether tool_call/result/thinking rows are searchable (source_type filter); `optimize` periodically to control size.
9. **resume UX security**: go through a structured `ResumeCommand` (program+args, not a shell string) to prevent id/path injection. **Actual implementation**: main uses `child_process.spawn` to launch a terminal (mac=osascript Terminal, Win=`cmd /c start`, Linux=probe x-terminal-emulator/gnome-terminal/konsole/xterm), **does not use node-pty** (no embedded pseudo-terminal); a provider with no id-resume degrades to "copy command".
10. **Native module packaging** (TS): **there is actually only one native module, `better-sqlite3`**, rebuilt per Electron ABI via `@electron/rebuild` (`rebuild:native`). The node-pty/chokidar we once planned were not used. Packaging/distribution (electron-builder) is not done yet.
11. **schema/version governance**: ship the downgrade guard + linear migrations + corrupt-DB self-healing on day one, plus a global cache-version stamp; otherwise changing the canonical shape is a data-loss hazard.

---

## 6. Next steps

- [ ] `pnpm init` the core package (pure TS, no Electron dependency): land `model.ts` / `provider.ts` / `index/` (schema.sql + scanner.ts, using better-sqlite3).
- [ ] First implement the `detect/sessionRoots/ownsPath/readHead/read/resumeCmd` of the three providers `claude-code` + `codex` + `gemini`, using real local sessions as fixtures.
- [ ] Implement the scanner's incremental classification + scan_state, getting "scan → index → list" working end-to-end (can start as a pure-TS CLI, then wrap in the Electron shell once validated).
- [ ] Wire **license-checker** into CI (SPDX allowlist); create `ATTRIBUTION.md`.
- [ ] qwen reuses GeminiLikeReader; opencode does db expansion; cursor marked experimental and deferred.
