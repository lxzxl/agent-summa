# @agent-summa/app

Electron shell wiring the Terminal UI to `@agent-summa/core`. Main process owns the SQLite index,
runs the cross-agent scan on launch, and exposes core over typed IPC; the renderer is the three-pane
session library (React 18 + TanStack Virtual + the multi-theme CSS-variable system, default Terminal).

## Run it (first time)

The repo install skips Electron's binary download and the native ABI rebuild (CI only builds, never
runs the GUI). To run locally:

```bash
# from repo root — fetch the Electron binary (allowed via onlyBuiltDependencies)
pnpm install

# rebuild better-sqlite3 against Electron's Node ABI (different from system Node)
pnpm --filter @agent-summa/app rebuild:native

# launch the app (electron-vite dev)
pnpm --filter @agent-summa/app dev
```

## Verify without a GUI

```bash
pnpm --filter @agent-summa/app typecheck   # main(node) + renderer(web)
pnpm --filter @agent-summa/app build       # electron-vite build → app/out/{main,preload,renderer}
```

## Layout

- `src/main/` — BrowserWindow (Terminal dark, native traffic lights), startup scan, IPC handlers calling core, mac Resume-in-Terminal.
- `src/preload/` — typed `window.api` bridge (contextIsolation).
- `src/renderer/` — React UI: sidebar (agent/source filters), virtualized session list, project grouping, full-text search, detail + Resume, Skills matrix, theme switch.
- `src/shared/ipc.ts` — the typed IPC contract used by both sides.

## Known refinements (not blocking the shell)

- Transcript viewer in the detail pane (core `read()`/FTS already done — wire an IPC `transcript(path)`).
- Resume launch on Windows/Linux (mac uses Terminal via osascript today).
- opencode/cursor providers (db-backed) to extend coverage to 6 agents.
