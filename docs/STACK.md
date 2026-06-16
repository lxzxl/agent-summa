# agent-summa · Tech Stack (actual, code is the source of truth)

> 2026-06-15 rewritten based on actual measurement of `core/package.json` + `app/package.json`. Machine: node v24.14.1 / pnpm 10.25.
> **Actual stack**: Electron + electron-vite + Vite 7 + React 18 + better-sqlite3 + react-markdown + @lobehub/icons + TypeScript.
> Pure TS, synchronous implementation, **no** Effect-TS / Zod / the full TanStack / oxc / Tailwind (planned, see the final section "Planned but dropped").

## Actual pinned versions

### Shell / build (`app` devDeps)
| Package | Version | Notes |
|---|---|---|
| electron | **^41.7.2** | ⚠️ **not 42** —— better-sqlite3 12.10 fails to compile against Electron 42's V8 (`SetNativeDataProperty` ambiguity, `External` missing tag). Under the Electron 41 ABI, `electron-rebuild -f -w better-sqlite3` succeeds. Don't upgrade to 42 (unless better-sqlite3 ships a compatible version or we switch to `node:sqlite`). |
| electron-vite | **^5.0.0** | peer caps at **Vite 7**; electron-vite 6 is still beta |
| vite | **^7.3.5** | constrained by electron-vite 5, **not 8** |
| @vitejs/plugin-react | **^4.7.0** | babel version (verified with vite7 + React18) |
| @electron/rebuild | ^4.0.4 | `pnpm --filter @agent-summa/app rebuild:native` rebuilds better-sqlite3 against the Electron ABI |
| typescript | ~6.0.3 | |

### Renderer (`app` deps)
| Package | Version | Purpose |
|---|---|---|
| react / react-dom | **^18.3.1** | **not 19** (@lobehub/icons peer wants 19, warning only; using base SVG via deep paths is unaffected) |
| @tanstack/react-virtual | ^3.14.2 | transcript virtual scrolling (the only TanStack package used) |
| react-markdown | ^10.1.0 | transcript + SKILL.md body rendering (GFM) |
| remark-gfm / remark-breaks | ^4.0.1 / ^4.0.0 | tables/strikethrough/task lists · soft line breaks |
| rehype-highlight | ^7.0.2 | code block syntax highlighting (highlight.js/lowlight, common language subset) |
| @lobehub/icons | ^5.10.0 | AI brand icons; **deep paths import only the base SVG** (`es/<Brand>/components/Color\|Mono`) to bypass its antd dependency (measured: 0 occurrences of antd in the bundle) |

### core (`core` deps)
| Package | Version | Purpose |
|---|---|---|
| better-sqlite3 | ^12.10.0 | **core's only runtime dependency**; the index database (synchronous, used raw) |
| tsx | ^4.20.0 (dev) | runs `core/src/cli.ts` (scan/list/fork…) |

> Note: after rebuilding better-sqlite3 for the Electron ABI, running the core CLI on the system node (tsx) requires another `node-gyp rebuild` back to the node ABI.

## Key constraints / pitfalls
1. **Electron pinned to 41** —— see the table above (better-sqlite3 V8 incompatible with 42).
2. **Vite 7, not 8** —— constrained by electron-vite 5.
3. **React 18, not 19** —— @lobehub/icons' react@19 peer is a warning only.
4. **Native modules rebuilt per ABI** —— better-sqlite3 needs a rebuild when switching between app (Electron ABI) and core CLI (node ABI).
5. **electron-vite dev does not watch `../core`** —— changes to core/main/preload all require a manual dev restart to re-bundle into main (only the renderer uses HMR).
6. **The index is a disposable cache** —— after changing a provider/scanner you must clear `index.db` and do a full rescan (the schema_version-mismatch branch only rebuilds FTS, leaving sessions untouched).

## Architecture (actual)
- **`core/`**: framework-agnostic pure TS (does not import Electron). `model.ts` (CanonicalSession/Provider contracts + hand-written parsing helpers) · `provider.ts` + `providers/{claude-code,codex,gemini,opencode,claude-desktop}.ts` · `index/{db,scanner,messages}.ts` (SQLite + scan_state incremental + FTS5 trigram) · `fork.ts` · `skills/{scan,distribute}.ts` · `memory/{scan,distribute,facts}.ts` (cross-agent instruction-file convergence + learned-facts browsing).
- **`app/`**: `src/{main,preload,renderer,shared}`, electron-vite. main/preload emit **CJS** + `externalizeDepsPlugin` (bundle `@agent-summa/core` in, externalize better-sqlite3). **Message-content FTS indexing runs in a separate `utilityProcess`** (`src/main/fts-worker.ts` → second main-build entry `out/main/fts-worker.cjs`): the heavy work (full file parsing + synchronous better-sqlite3 writes) leaves the main thread, with progress going through `process.parentPort`→main→renderer (shown in the statusbar); incremental (the `sessions.fts_indexed` marker, empty sessions skipped). The utilityProcess runs Electron's Node → the better-sqlite3 ABI matches automatically. **The renderer is modularized** (2026-06-15, split out from a 1329-line single-file App.tsx): `App.tsx` is now just the shell (rail + grid + view routing + shared state, ~150 lines) · `lib/{format,agents,frontmatter,layout}` · `components/` (Tooltip/MarkdownBody/Msg/TranscriptView/SubagentList/ContextMatrix/LearnedFacts/AgentConfig, one file each) · `views/{SessionsView,SkillsView,AgentsView}` (each owning its view-local state).
- **Type-safe IPC**: **hand-written** (the `Api` interface in `shared/ipc.ts` + `declare global window.api`), not using `@electron-toolkit/typed-ipc`.
- **Theming**: CSS variables + the `[data-theme]` root attribute (terminal/graphite/spotlight); themes only swap color tokens, structural tokens are fixed globally.
- **i18n**: **hand-written** `renderer/i18n.ts` (DICT + `makeT` + `I18nContext`/`useT`, en default/zh), not using paraglide.
- **Parsing/validation**: **hand-written type guards** (`as Record<string, unknown>` + `typeof` + `try/catch`), not using Zod, not using gray-matter (frontmatter parsed by hand).

## Planned but dropped (and why)
The early STACK decided on a whole pile of things; during implementation they were cut following "simplest that's good enough". Recorded here to avoid confusion:

| Planned | Actual | Reason |
|---|---|---|
| **Effect-TS** (effect / @effect/platform / @effect/sql / @effect/vitest) | ❌ zero dependency, zero imports | core is synchronous fs reads + better-sqlite3 + plain async IPC, no need for Layer/Effect.gen/cancellation/resource management; over-engineering for this job |
| **@effect/sql-sqlite-node** | ❌ bare better-sqlite3 | same as above |
| **Zod** | ❌ hand-written type guards | provider parsing volume is small, hand-written `try/catch`+typeof is good enough |
| **TanStack router / query / table / store / start** | only **react-virtual** | single component + nav state, no routing; IPC results go straight to setState, no query cache needed; lists don't use table |
| **oxc (oxlint/oxfmt) / Biome** | ✅ **oxlint added** (2026-06-16, `pnpm lint` = `oxlint core/src app/src`) | format still not configured (prettier as fallback); oxlint's zero-config is good enough |
| **node-pty** | ❌ | resume uses `spawn` (mac=osascript Terminal, Win=cmd start, Linux=terminal detection), no embedded pty |
| **chokidar** | ❌ | no fs watch yet (rescan relies on a manual ↻ / startup scan) |
| **gray-matter** | ❌ hand-written frontmatter parsing | same reason as Zod |
| **Tailwind 4 / shadcn / Radix / cva / cmdk / sonner / vaul** | ❌ pure CSS variables + self-written components | the dark terminal style is simple, hand-written is more controllable and zero-dependency |
| **vitest / Playwright** | ✅ **vitest added** (2026-06-16, `core/test/*.test.ts`, 18 cases: frontmatter / memory converge+unlink / scan divergence / util); Playwright still absent | core tests are limited to pure logic + fs (no touching better-sqlite3—it's usually on the Electron ABI and won't run on node); the FTS/DB layer is untested |
| **electron-builder** | ❌ only `dev`/`build` for now (no packaging/distribution) | packaging into `.app`/`.exe` is for later |
| **@inlang/paraglide-js** | ❌ hand-written i18n.ts | see above |

> Bring in packaging/testing/lint when you want to add them; don't assume something is installed just because this table says it was "once planned".

## References
- Early on we drew on an isomorphic reference Electron desktop app (prior art) (the source of the electron-vite/vite7/React18/better-sqlite3/TS6/pnpm10 practices); but that project used Effect (control flow/DI)/Zod/Tailwind+shadcn/Biome, **none of which agent-summa followed** — we only borrowed the structure and Electron configuration mechanism (without referencing its code).
- For the detailed core design see `CORE-DESIGN.md`, for the UI see `UI.md`.
