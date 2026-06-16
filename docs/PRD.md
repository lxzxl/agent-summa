# PRD — agent-summa: Cross-Agent Session and Skills Manager

> Status: **v1.0 (finalized)** · 2026-06-14 · Product name **agent-summa** (Σ family, "complete set / sum total"; name-collision check in §10)
> All design gates passed: this PRD + `CORE-DESIGN.md` + `STACK.md` + `UI.md` — all four are in place, implementation can begin. Decision log in §11, milestones in §14, document map in §16.

---

## 1. One-Line Positioning

A **local-first console** for power users who **run multiple AI coding agents at once**:
it **aggregates the history sessions scattered across each agent into a single searchable unified library**, supports **one-click resume**, and can **fork across agents**, plus unified skills management.

**Differentiation core (most important)**: existing comparable projects (see §9) are almost all **live orchestrators** (wrap PTY/tmux to run multiple agents in parallel). **The "cross-tool history-session aggregation + search + resume" lane is essentially unoccupied** — and that is this product's foothold.

---

## 2. Target Users and Pain Points

- **Users**: developers running ≥2 CLI agents (Claude Code / Codex / Gemini / Qwen / opencode / cursor…) on a single machine.
- **Core pain point**: "Which agent / which project was that session from last week in? What was it called? Can I still keep running it?" Today each agent operates in isolation, with no unified cross-tool search/resume.
- **Not served**: light users of a single agent (insufficient value).

---

## 3. Product Principles (they decide every trade-off)

1. **Local-first**: read only the local machine, the user's own files; zero accounts, zero servers, zero outbound transfer.
2. **Read-first, reversible writes**: by default only index/display; write operations (fork, skill distribution) only touch artifacts registered in our own manifest, leaving original files untouched.
3. **The index is a discardable cache; the JSONL is the source of truth**: a corrupt index can be deleted and rebuilt — never treat the index as the sole truth.
4. **Honestly label what is lossy**: cross-agent fork is "reopen with context," not verbatim resume — the UI must make this clear.
5. **One adapter per agent, with version detection**: private formats change across versions, so isolate them all in the adapter layer.

---

## 4. Locked-In Scope Decisions

| Dimension | Decision |
|---|---|
| **MVP main line** | M1 unified session library + M2 one-click resume (fork deferred to P1) |
| **Platforms** | macOS + Windows (dual-platform; path/symlink differences in §7.4) |
| **Agents supported** | Claude Code CLI (including CC sessions inside Claude Desktop), Codex, Gemini CLI, Qwen / opencode / cursor (read + resume all included; fork for the first three only at first) |
| **Tech stack** | Electron 41 + electron-vite 5 + Vite 7 + React 18 + TS6; renderer uses `@tanstack/react-virtual` + `react-markdown` (+rehype-highlight) + `@lobehub/icons`; DB is bare `better-sqlite3`. **During implementation we dropped Effect-TS / Zod / the full TanStack suite / oxc / Tailwind-shadcn** (pure TS + hand-written parsing/components, minimal sufficiency); `core` is framework-agnostic and decoupled from the shell; **see `STACK.md` for the actual stack**; Rust/Tauri kept as a fallback |
| **Visuals / themes** | **Terminal** (Warp-style, default) + **multiple switchable themes** (CSS-variable contract + `data-theme` attribute toggle); three-column master-detail, details in `UI.md` |

---

## 5. Feasibility Ground Truth (measured on the local machine, as the foundation for requirements)

| Source | Session readable | Resumable | Forkable | Basis |
|---|---|---|---|---|
| Claude Code CLI | ✅ plaintext JSONL | ✅ injection-based resume verified locally | ✅ | `~/.claude/projects/<enc-cwd>/<sessionId>.jsonl`, 1327 on this machine |
| Codex CLI / Codex desktop·IDE | ✅ rollout JSONL | ✅ `codex resume` | ✅ | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; shared by desktop/IDE |
| Gemini CLI | ✅ JSONL | ✅ `--resume` | ✅ (has `--session-file` import) | `~/.gemini/tmp/<proj>/chats/` |
| Qwen / opencode / cursor | ✅ JSONL | ✅ | ⚠️ import is somewhat hacky | `~/.qwen`, `~/.config/opencode`, `~/.cursor/projects` |
| **CC sessions inside Claude Desktop** | ✅ **79% already in `~/.claude/projects`** | ✅ this portion can `claude --resume` | ✅ | 140 `local_*.json` indexes; **111 hits**, 29 in VM |
| Claude Desktop Cowork **VM sandbox** sessions | ⚠️ locked in `vm_bundles/claudevm.bundle/rootfs.img` (10G) | ❌ host cannot resume directly | ❌ | 21%; requires read-only mount of the ext4 image (P2) |
| Claude / ChatGPT desktop **chat conversations** | ❌ cloud-bound | ❌ | ❌ | transcripts are cloud-bound (only drafts live locally) → **not doing it** (§8) |

**Conclusion**: "Claude Code sessions inside Claude Desktop" ≈ roughly 80% are already in `~/.claude/projects`. We only need to read `claude-code-sessions/<deviceId>/<accountId>/local_*.json` as a **metadata index** (title/cwd/model/turns/archived) and join via `cliSessionId` to the CLI transcript files. The remaining 20% in the VM is broken out into P2.

---

## 6. Functional Requirements

### M1 Unified Session Library (P0 · core)
- **Discover + index** the history sessions of all supported agents → unified schema:
  `{ agent, sessionId, projectId, projectPath/cwd, title, titleSource, model, createdAt, lastActivityAt, rounds, messageCount, archived, source(cli|app-code|app-web|vm), backingPath }`
- **Claude Desktop join**: read `local_*.json` for metadata such as title, associate via `cliSessionId` with `~/.claude/projects/<enc-cwd>/<cliSessionId>.jsonl`; mark hits `source=app-code`, and misses (VM) `source=vm · transcript locked`.
- **Search/filter**: by project / time / model / agent / keyword; full-text search runs on FTS5 (§7.2).
- **Acceptance**: cold-start list of ≥3000 sessions in a single library < 2s (relying on head_tail rather than full parsing, §7.2); filtering is instant.

### M2 One-Click Resume (P0)
- A "Continue" button per session → assembles that agent's native resume command and launches it in the corresponding cwd:
  `claude --resume <id>` / `codex resume <id>` / `gemini --resume <id>` / `qwen --resume <id>`.
- **Acceptance**: 100% success rate for CLI and desktop-host (`app-code`) sessions; VM sessions grayed out with the reason explained.

> **UI is locked** (see `UI.md`): three-column master-detail; **MVP detail pane = metadata + Resume**, transcript viewer = a P1 fast follow. Key simplification: **MVP only needs the provider's `readHead()` + `resumeCmd()`; `read()` (full transcript parsing, DAG linearization, tool pairing) is deferred** — greatly lowering MVP risk. MVP search covers title/lastPrompt/project/model; message full-text search lands together with the transcript viewer.

### M3 Skills Overview (P1, can start in parallel with M1)
- Scan `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`, `~/.agents/skills`, `~/.qwen/skills`, `~/.copilot/skills`, `~/.cursor/skills`, etc., parse SKILL.md frontmatter, list the skill × agent install matrix, and flag duplicates / version mismatches.

### M4 Cross-Agent Fork (P1)
- `source session → NeutralSession neutral IR → target agent writer`, written as a new session for the target agent (new id, source untouched).
- Neutral IR (following the design of a session-archive bridge from prior art): `NeutralSession{ sourceCli, sourceSessionId, cwd, startedAt, turns:[{role, text, toolSummaries[], timestamp}] }`.
- **Key constraint**: tool calls are **downgraded to text summaries** (structured calls/state are not preserved with fidelity), and the UI explicitly labels this "reopen with context."

### M5 Skills Central Library + Distribution (P1)
- `~/.agents/skills` as the single source + symlink distribution to each agent; on Windows fall back to junction/copy; the manifest records source and destination, allowing clean uninstall.

### P2 (later)
- VM sandbox session extraction (read-only mount of `rootfs.img`).
- Skills security scanning + quality/scoring signals (incorporating the differentiation from early competitor analysis: security audit > star rating, see research conclusions).
- Team distribution / config sync.
- Read-only integration of desktop chat apps (cloud chat-conversation history, **only with the user's explicit authorization**).

---

## 7. Technical Architecture

### 7.1 Layering
```
Electron + TypeScript (main process Node/TS + render layer TS/React)
├─ core (framework-agnostic TS package, does not import Electron, can run standalone as a CLI)
│   ├─ adapters/    per agent: detect() · sessionRoots() · listSessions() · readSession(path)->CanonicalSession · resumeCmd() · skillsDir()
│   ├─ index/       SQLite + scan_state incremental index + FTS5 (§7.2)
│   ├─ neutral/     NeutralSession IR (for fork, §6 M4)
│   └─ manifest/    write-operation registry (reversible/uninstallable)
└─ ui              session library / resume / fork flow / skills matrix
```

Stack choice Electron + TS: this project is I/O- and index-bound (not CPU-intensive), and `read_head` + incremental already offset Rust's speed advantage; TS shares one language front and back, iterates fast, and fits the existing skill set; Chromium is bundled → consistent mac/Win UI rendering (avoiding the WKWebView vs WebView2 dispute). The cost = size (~100MB+) + native-module packaging (§7.4). **Key: core is decoupled from the shell** — if size/performance become real problems we can swap in a Tauri shell (frontend unchanged) or build the hot-path scanner as a Rust sidecar/napi. The blueprints — a reference Electron desktop app (prior art) and a prior session-archive prototype (prior art) — are Rust, but its Rust session-reader crate cannot be copied and is a clean-room rewrite anyway; patterns like `scan_state` / `head_tail` / FTS5 are language-agnostic. See `CORE-DESIGN.md`.

### 7.2 Index Design (directly benchmarked against a prior session-archive prototype (prior art) + a reference Electron desktop app (prior art))
- **Storage**: `better-sqlite3` (FTS5 bundled) placed in Electron's `app.getPath('userData')`. Tables:
  - `sessions` (denormalized: title/summary/cwd/last_message/rounds/message_count/created_at/last_modified/usage/source)
  - `message_entries` (per-entry, indexed by `(session_path, timestamp)`)
  - `fts5` virtual table (message full-text search, **single source of truth, do not double-write**)
  - `session_details_cache` (per-model token/cost)
  - `scan_state` (**the incremental core**, keyed by `backing_path`: `{provider_slug, file_modified, file_size, last_scanned_at, last_parse_status, read_offset, append_trust_count}`)
  - `schema_version` / `app_version_info` (migration ladder)
- **Incremental scan**: enumerate transcript files → compare `(mtime, size, last_parse_status==ok)` to classify cached-skip / needs-parse; only stale files enter the parallel parse pool. JSONL is append-only → store `read_offset` and **parse only the newly appended bytes**.
- **No full parse on first screen**: use `read_head_tail` (only the first + last 64KB) to get title/summary/cwd/lastPrompt plus approximate rounds/messageCount; full parsing happens only when opening a session or building FTS.
- **Concurrency convergence**: single-flight guard + short TTL (mirroring the prior art's 3s inflight); fs-watcher (`chokidar`) + 500ms debounce; a new scan cancels an in-flight scan.
- **Discardable**: the cache carries a version stamp (the prior art's `SESSIONS_CACHE_VERSION`, and `LATEST_SCHEMA_VERSION`); on shape drift it is silently discarded; a corrupt DB (hard quit) → delete and rebuild (the prior art's `corrupted_sqlite_test.rs` pattern).

### 7.3 Import / Normalization / Dedup (benchmarked against a reference Electron desktop app (prior art) + its Rust session-reader crate)
- **per-source reader** → **one flat Session struct** (see §6 M1 schema).
- **Title priority** (mirroring Claude itself, per the reference app): customTitle(tail) > customTitle(head) > aiTitle(tail) > aiTitle(head) > slug; record `titleSource` for the UI to display the source.
- **Cross-tool + cross-app dedup** (hardest, most valuable): merge all sources, with Codex keyed as `codex:{id}`; **join Claude Desktop**: read `local_*.json.cliSessionId` to associate the CLI transcript; on conflict **keep the highest rounds / prefer the app title / prefer the project_path that still exists on disk**.
- **path → Claude project directory encoding**: after `path.resolve()`, replace `[/\.]` (slashes **and dots**) with `-`; respect `$CLAUDE_CONFIG_DIR` (the same encoding Claude Code itself uses).
- **The prior-art Rust session-reader crate cannot be reused (verified)**: its LICENSE is "MIT **with an OpenAI/Anthropic rider**," which explicitly does not grant rights to Anthropic and "those acting on its behalf" and forbids use in an ML pipeline → **legally closed off: do not vendor / depend on / copy the source**. Instead, a **clean-room rewrite** of the IR + Provider trait + registry (from public format knowledge), mirroring only the *architectural patterns* of the prior-art apps. See `CORE-DESIGN.md`. CI uses `license-checker` (npm SPDX allowlist) to prevent restricted dependencies from creeping in.

### 7.4 Windows Adaptation (must be handled early for dual-platform)
- Paths: Claude Desktop `%AppData%\Roaming\Claude`; Codex `%USERPROFILE%\.codex`; Claude CLI `%USERPROFILE%\.claude`.
- symlink → **junction / copy fallback** (an ordinary user needs developer mode to create a symlink — this is the biggest cross-platform pitfall).
- Path-encoding case/separator differences are normalized within the adapter.

---

## 8. Explicitly Not Doing / Blocked (red lines)

- ❌ Extracting Claude / ChatGPT desktop **chat conversations** (cloud-bound; only drafts are local).
- ❌ **Fully faithful** fork (lossless tool calls / execution state) — technically infeasible, only a text-level promise.
- ❌ Any **automatic outbound transfer** of data. Cloud chat-conversation history is a P2 idea, off by default and only with the user's explicit authorization.

---

## 9. Competitive Landscape (surveyed 2026-06)

The existing comparable tools fall into two buckets — neither occupies this product's lane:

- **Live multi-agent orchestrators** (the large majority): TUI/desktop wrappers around PTY/tmux that run several agents in parallel (various stacks — Go/BubbleTea, Rust, native macOS). They manage *running* sessions, **not** historical aggregation. We borrow only sub-patterns from them (an XDG sqlite layout, event-dedup keys, a cost hook + backfill).
- **Read-only history viewers** (a few, closest in spirit): Tauri/React apps that browse one or two agents' past sessions. Same problem space, but single-/few-agent and view-only — no cross-tool unification, resume, or fork.

The **cross-tool history aggregation + search + resume + cross-agent fork** lane is essentially unoccupied — that is this product's foothold. (Several live-orchestrator projects appeared within days of each other in mid-2026: the parallel-run concept is hot, but the history lane stayed empty.)

---

## 10. Naming — Decided: agent-summa

We chose **agent-summa**. The meaning comes from the Σ family's "complete set / sum total" (Summa = sum total): **aggregating** multiple agents' sessions into one place, consistent with the product core.

Name-collision check (2026-06-13):
- npm `agent-summa` ✅ available (bare `summa` is taken, so we use the prefixed form; the CLI binary name is decided separately).
- No Homebrew `summa` formula ✅.
- No well-known GitHub repo named "summa"/"agent-summa" — all 170k hits are "summary/summarize/summarizer" substring noise, **no big-name collision, no NSFW collision** (two earlier name candidates were rejected for collisions: one clashes with a ~12.5k★ adult-content organizer, the other with a popular live-orchestrator project).
- ⚠️ Note: the English "summa/summary" is saturated by "summary-type" tools, so for outbound communication/SEO the prefixed **agent-summa** is safer; domains (agentsumma.dev/.ai etc.) cannot be checked inside the sandbox and need local `whois` verification.

---

## 11. Decision Log (all product-level decisions are closed)

Implementation-level tasks are in §14; this section is the log of finalized product decisions.

- [x] **Product name** → agent-summa (§10)
- [x] **Prior-art crate license** → unusable (MIT + an OpenAI/Anthropic rider); switched to a clean-room rewrite of IR/Provider/registry (§7.3 · `CORE-DESIGN.md`)
- [x] **MVP scope** → unified session library + Resume; detail pane = metadata + Resume; transcript viewer / fork / skills = P1 (§4 · §6)
- [x] **Platforms** → macOS + Windows (§4 · §7.4)
- [x] **Tech stack** → Electron41 + electron-vite5 + Vite7 + React18 + TS6 + bare better-sqlite3 (react-virtual / react-markdown / @lobehub/icons); **Effect / Zod / the full TanStack suite / oxc were planned but unused**, with the actual stack and the "planned but unused" list in `STACK.md`
- [x] **Index/import** → SQLite + scan_state incremental + FTS5 + head_tail; projects grouped by **git root** (§7 · `CORE-DESIGN.md`)
- [x] **FTS trade-off** → go with SQLite + FTS5 (cross-agent search needs it; a pure cache is only enough for a minimal demo)
- [x] **UI layout** → three-column master-detail, flat "All Sessions" + filters + project grouping (§12 · `UI.md`)
- [x] **Visuals/themes** → Terminal default + multi-theme architecture (§12 · `UI.md`)

---

## 12. UI/UX Overview (details in `UI.md`)

- **Layout**: three-column master-detail (left filters/navigation · center virtualized session list · right details + Resume) + command palette (⌘K) + status bar.
- **Core interactions**: ⌘K command palette · `↑↓`/`Enter` keyboard operation (default selection = most recent activity, "open and hit enter") · `Group by project` (git-root grouping, cross-agent aggregation) · one-click Resume.
- **MVP detail pane** = metadata + Resume (transcript viewer = P1).
- **Visuals**: **Terminal** (Warp-style: near-black / cyan electric / monospace / square right angles) as the default theme; **multiple switchable themes** — CSS-variable contract + `data-theme` attribute toggle, adding a theme = adding one set of tokens, zero component changes; built-in Terminal/Graphite/Spotlight, with future support for user-defined themes.
- **Native feel**: Electron but leaning native — real window chrome (`hiddenInset`/`titleBarOverlay`), no `cursor:pointer`, native context menus, OS notifications, theme set before the first frame to prevent FOUC.

---

## 13. Success Criteria and Acceptance

**MVP acceptance (M1 + M2) — three hard metrics:**
1. **Aggregation completeness**: automatically discover and index all history sessions of ≥3 agents on this machine (Claude Code + Codex + Gemini), including Claude Desktop's CC sessions. Measured baseline on this machine ≥572 sessions / ≥34 projects (§5).
2. **Findability**: any past session can be located within the unified library by project / agent / model / keyword / time in ≤3 steps; cold-start list of ≥3000 sessions < 2s (head_tail, §7.2).
3. **Resumability**: 100% Resume success rate for CLI and `app-code` sessions; VM / no-cwd sessions clearly grayed out with the reason explained.

- **North star**: the time for a user to "find and resume an old cross-agent session," from "can't remember where it is, can't dig it up" → **< 10s**.
- **Counter-metrics**: a session bucketed wrong (dedup/project-grouping errors); index corruption causing data loss (the index must be rebuildable).

---

## 14. Milestones and Roadmap

| Stage | Content | Exit criteria |
|---|---|---|
| **M0 foundation** | scaffold (pnpm workspace `app/` + `core/`, electron-vite config, Terminal theme skeleton + multi-theme switching); `core`'s `model.ts` / `provider.ts` / `index/` (schema + scanner) | empty shell runs, three columns + theme switching visible, CI license-checker green |
| **M1 session library (P0)** | the `detect/sessionRoots/ownsPath/readHead/resumeCmd` of the claude-code/codex/gemini three providers; scan_state incremental; unified library + search/filter/project grouping; Claude Desktop join | the three hard metrics in §13 met |
| **M2 Resume (P0)** | one-click Resume (`child_process.spawn` to launch a terminal, not node-pty); qwen/opencode read + resume already included (cursor pending install) | Resume success rate met, VM grayed out |
| **v1 (P1)** | transcript viewer (full `read()` + DAG linearization + full-text FTS) · cross-agent fork (NeutralSession) · Skills overview + central-library distribution | details show history, fork works, skills matrix |
| **later (P2)** | VM image extraction · skills security/quality signals · team distribution · read-only integration of desktop chat apps (explicit authorization) | — |

**Immediate next step**: M0 scaffold (based on a mature Electron desktop config baseline + Terminal tokens; first study the prior-art apps in the space).

---

## 15. Risks and Countermeasures (PRD level; full list in `CORE-DESIGN.md §5`)

| Risk | Countermeasure |
|---|---|
| Private JSONL format drifts across agent versions | per-agent adapter with version detection + real session fixtures; degrade to read-only on parse failure |
| Index corruption / hard quit | treat the index as a discardable cache: on corruption, delete and rebuild, JSONL is the sole source of truth |
| Cross-agent / cross-app dedup bucketing errors | cliSessionId join + full `project_root` path + the "highest rounds / app title / existing path" rule |
| fork fidelity (tool calls/state loss) | product semantics = "reopen with context," explicitly labeled in the UI; only a text-level promise |
| Windows symlink / path / native modules | junction/copy fallback + per-OS path table + `@electron/rebuild` (better-sqlite3 only) |
| Compliance (cloud chat extraction) | hold the line on local-first: local machine / user account / explicit authorization / never outbound; desktop chat integration listed in P2, off by default |
| Concurrent competitors (several live orchestrators started around the same time) | hold the differentiation = history aggregation (they all do live orchestration); ship the MVP fast |

---

## 16. Related Documents

| Document | Content |
|---|---|
| **`PRD.md`** (this file) | product requirements, scope, acceptance, milestones (v1.0 finalized) |
| `CORE-DESIGN.md` | `core` design: CanonicalSession / Provider interface, SQLite schema, per-agent mapping, full risks |
| `STACK.md` | actual dependency versions, the "planned but unused" list, gotchas |
| `UI.md` | three-column layout, Terminal default theme + multi-theme architecture, native-feel constraints, keyboard map |
