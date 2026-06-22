# Work Log

## 2026-06-22 — README fix · new app icon · oh-my-pi support

Three deliverables, all complete and verified.

### 1. README Status fix
The Status section claimed packaging "is not done yet", but `chore: electron-builder packaging + v0.1.0` had already landed (dmg/nsis/AppImage targets + `dist` scripts in `app/package.json`).
- `README.md` — rewrote the Status line to describe `pnpm --filter @agent-summa/app dist` → `.dmg` / NSIS / AppImage.

### 2. New app icon (replaces the framework default)
There was **no** custom icon or favicon — packaging fell back to Electron's default. Added a self-authored mark: a macOS squircle, indigo→rose gradient, white **Σ** (*summa* = the sum of every agent's sessions). `generate_image` had no credentials, so the SVG was rasterized via the headless browser.
- `app/build/icon.svg` — master vector (new).
- `app/build/icon.png` — 1024² transparent raster, browser-rendered (new).
- `app/build/icon.icns` — built via `sips` + `iconutil` (new). electron-builder auto-derives the Windows `.ico` from `icon.png`.
- `app/src/renderer/icon.svg` + `index.html` `<link rel="icon">` — window/tab favicon (new/edit).
- `app/src/main/index.ts` — dev-time window/dock icon (`app.dock.setIcon` on macOS, `icon` option elsewhere), guarded by `existsSync`; packaged builds use the bundle icon.
- `.gitignore` — `build/` (node-gyp) was also hiding `app/build/`; added `!app/build/` + `!app/build/**` so the packaging resources are tracked.

### 3. oh-my-pi / Pi agent support
`omp` (`~/.omp/agent`, binary `/opt/homebrew/bin/omp`) and the legacy `pi` (`~/.pi/agent`) are the same agent family with an identical JSONL session format (`type:"session"` v3 header + tree entries). One provider reads both homes.

On-disk facts established from real sessions:
- Sessions: `<agent>/sessions/<dir-encoded>/<timestamp>_<sessionId>.jsonl`; `<agent>` honors `PI_CODING_AGENT_DIR` / `PI_CONFIG_DIR`.
- Message content blocks: `text`, `thinking`, `toolCall` (`{id,name,arguments}`). Tool output is a **separate** `message` with `role:"toolResult"` (`toolCallId`, `toolName`, content blocks).
- `model_change`: `model:"provider/id"` (current) or `provider`+`modelId` (legacy pi).
- Subagent transcripts + bash logs live in a `<timestamp>_<id>/` sidecar dir.
- Resume: `omp --resume <id>` (global id-prefix match).

Core (`core/`):
- `core/src/providers/oh-my-pi.ts` (new) — `OhMyPiProvider`: detect / sessionRoots (omp + legacy pi) / skillsDir (prefers whichever home has skills) / list (timestamp-prefix regex excludes sidecar transcripts) / ownsPath / readHead / read (text + tool calls + tool results, chronological) / resumeCmd.
- `core/src/registry.ts` — registered in `builtinRegistry()`.
- `core/src/provider.ts` — `pi → oh-my-pi` alias.
- `core/src/fork.ts` — `writeOmpFork` + `WRITERS["oh-my-pi"]`, so omp is a fork **target** (and, via `read()`, a fork **source**). Fork entries get monotonic timestamps from fork time so the banner stays first.
- `core/src/memory/scan.ts` — `agentHome("oh-my-pi")` → omp agent dir; global slot `~/.omp/agent/AGENTS.md`; added `oh-my-pi` to the project-root `AGENTS.md` readers.

App (`app/`):
- `app/src/renderer/lib/agents.tsx` — brand color `#E0556E` + a custom `OhMyPiIcon` (π) since there's no @lobehub mark.
- `app/src/renderer/views/SessionsView.tsx` — `oh-my-pi` added to the fork-target buttons.
- `app/src/main/index.ts` — fork IPC handler `oh-my-pi` branch: writes into `~/.omp/agent/sessions/<enc>/` using omp's home-relative dir encoding.

Docs:
- `README.md` — `oh-my-pi` in the intro list + supported-agents table (Read ✅ Resume ✅ Fork ✅).
- `package.json` — description lists `oh-my-pi`.

Resolved (confirmed N/A): omp learned-fact browsing — `~/.omp/agent/agent.db` was inspected read-only and holds only auth credentials / usage & cost history / model cache / settings. There is **no** learned-fact store and no `memory/` dir (unlike Claude's `memory/*.md`), so there is nothing to browse — and `agent.db` is deliberately **not** read because it contains secrets (auth tokens). Sessions / skills / memory (instruction files) / resume / fork are fully covered.

### Verification
- `pnpm typecheck` — clean (core + app).
- `pnpm lint` (oxlint) — clean.
- `pnpm test` — **25 passed** (6 new oh-my-pi: readHead, title fallback, legacy model id, read+toolResults, routing, fork round-trip).
- `pnpm --filter @agent-summa/app build` (electron-vite) — clean; favicon emitted as a hashed asset.
- Real-data smoke (provider against live `~/.omp` + `~/.pi`): 8 sessions discovered, titles/models/`resume` correct (incl. legacy `deepseek/deepseek-v4-pro`), newest session → 138 messages / 89 tool calls, roles `user/assistant/tool`, tool results captured.
