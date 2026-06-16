# agent-summa · UI Layout (locked v1)

> 2026-06-13. The base layout is settled and can drive the shell/routing/components from here. Reference mockup: `agent_summa_main_layout` (three-column master-detail).

## Settled decisions

1. **Detail pane = embedded third column** (master-detail; list and detail coexist on the same screen).
2. **MVP detail pane = metadata + Resume**; **transcript viewer (viewing historical conversation content) = P1 fast follow**.
3. **List = flat "All sessions" + left-rail filters** (unified cross-agent search; the primary differentiator).

## Form: three-column desktop window

```
┌───────────────────────────────────────────────┐
│ ●●●  agent-summa                  ↻   ⌘K       │  title bar (frameless, mac traffic lights)
├─────────┬────────────────────┬──────────────────┤
│ Nav      │ ⌘K search + sort    │ detail head (title+chips) │
│ Sessions│ ──────────────     │ [Resume] Fork→ … │
│ Skills  │ ○ session row (virtualized) │ ──────────────   │
│ Settings│ ○ session row       │ metadata / placeholder │
│ ──      │ ● selected (left accent) │ (transcript viewer=P1) │
│ Agents  │ ○ …               │                  │
│ ·CC 1327│                    │                  │
│ ·Codex  │                    │                  │
│ Source  │                    │                  │
│ Projects│                    │                  │
├─────────┴────────────────────┴──────────────────┤
│ 1,613 sessions · 6 agents   last scan 2s · ⌘K   │  status bar
└───────────────────────────────────────────────┘
```

### Title bar
frameless; mac traffic lights + app name + refresh (manual rescan) + `⌘K` hint.

### Left rail (~144px, collapsible)
- **Nav**: Sessions / Skills / Settings (icon + name).
- **Filter groups** (click = toggle):
  - Agents: color dot + name + **live count** (Claude Code teal / Codex purple / Gemini blue / Qwen amber / opencode coral / cursor gray).
  - Source: CLI / Desktop / VM(locked).
  - Projects: project name + count.
- Favorites / Tags (P1).

### Center column (session list, flex≈0.92)
- Top: `⌘K` search box (cmdk + FTS), **`Group by:` none (time, default) / project / agent / date**, sort, count.
- **Group-by-project view** (not in conflict with "flat + filters"; just a view toggle): collapsible **project group headers** (project name + session count + most recent activity + small cross-agent color dots), with sessions nested under the header; still virtualized (`header row + session row` flattened + sticky header). A project = **git root** (see CORE-DESIGN `project_root`); sessions naturally cluster into one group across agents (measured on this machine: 572 sessions → 34 projects, with headers frequently spanning cli/desktop/codex); name collisions are disambiguated by appending the parent directory; no cwd → "Unknown project" group. The left-rail Projects filter reuses the same `GROUP BY project_root` query.
- **Virtualized rows** (`@tanstack/react-virtual`, handles thousands of rows): agent color dot + title (ellipsized) + metadata row (`project · model · relative time · N turns`) + source pill (CLI neutral / Desktop info / VM warning+lock).
- Selected state: 2px left accent + secondary background (single-side border, no rounded corners added).
- **Empty state / scanning state** (P0, required).

### Right column (detail, flex≈1.18) — MVP scope
- Detail head: title (editable) + metadata chips (agent / model / project path / time / turn count / tokens).
- Action bar: **Resume** (primary action, play icon), `Fork →` (P1, placeholder/disabled), export / open directory / favorite.
- Main body below: **MVP shows a placeholder/summary first**; the transcript viewer fills it in P1.
- **VM sessions**: Resume grayed out + "transcript locked in VM" explanation.

### Status bar
`total · agent count · last scan · ⌘K`. The theme follows the system light/dark mode (verified to adapt automatically).

## Navigation (actual: no router, pure state)

No TanStack Router / file-based routing. A single component + state:
- `nav` switches the Sessions / Skills views (sidebar buttons).
- Selected state: Sessions selects `selected`, Skills selects `skillSel`; the detail pane fills based on the selection (master-detail, not URL).
- Settings: `settingsOpen` opens the `.modal` (language / theme), not a route.
- Sub-agent drill-down: `childSel` + `detailTab` (transcript / sub-agent tabs), breadcrumb to go back.

## Component mapping (actual)

All hand-written + CSS variables, **not using** shadcn/Radix/cmdk/sonner/vaul/lucide:
- Three-column + draggable: hand-written grid (inline column widths) + absolutely positioned drag handles + localStorage persistence (not `react-resizable-panels`).
- Transcript virtual list: `@tanstack/react-virtual` (dynamic height measurement via `measureElement`).
- markdown / code highlighting: `react-markdown` + `remark-gfm`/`remark-breaks` + `rehype-highlight`.
- agent brand icons: `@lobehub/icons` (deep-path import for the base SVG, to avoid antd).
- toast: home-grown (status-bar `toast` state, not sonner); confirmations use `window.confirm`.
- overlays: home-grown `.modal` (settings).
- i18n: home-grown `renderer/i18n.ts` (`useT()`, en default / zh).
- icon glyphs: emoji/Unicode (⧉ ⑂ 🗑 ↻ ⚙ ⊕ ⎋ ⌫…), not lucide.

## Key engineering simplification (because MVP detail = metadata + Resume)

The MVP only needs the provider's **`readHead()` + `resumeCmd()`**; **`read()` (full transcript parsing) is deferred to the transcript-viewer phase** → parentUuid DAG linearization, tool-call pairing, per-vendor message-format adaptation, and similar hard problems are **all off the MVP critical path**.

**MVP critical path**: `detect → list → readHead → ingest (scan_state incremental) → list/filter/search → resume`.
- Note: with only `readHead`, search covers **title / lastPrompt / summary / project / model**; **full-text message search (FTS over message_entries) lands together with `read()` / the transcript viewer**.

## Fast follows (P1)

Transcript viewer (full `read()` + DAG linearization + message rendering + full-text FTS), Skills matrix, Fork wizard, command-palette action expansion, Favorites/Tags, panel-layout persistence.

---

## Visual style: Terminal (default theme) + multi-theme architecture

**Terminal (the Warp family) is chosen as the default base tone**: near-black, cyan electric accent, **monospace-first**, square right angles, left gutter on the selected row. Deliberately distinct from a pure-white "document" style. The design was explored across three theme sets (Terminal default / Graphite / Spotlight).

> **Built for multiple themes from day 1** — the prototype already verified: with a full CSS-variable contract + flipping a single root attribute, **adding a theme = adding one set of tokens, with zero component changes**.

### Fonts
- **chrome/UI**: system font `-apple-system, "Segoe UI Variable", "Segoe UI", "PingFang SC", system-ui, sans-serif`.
- **monospace for technical content (under Terminal, even titles use it)**: id/path/model/command/turn count/token → `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, monospace`.

### Terminal default tokens (from the prototype terminal variant)
| token | value | · | token | value |
|---|---|---|---|---|
| `--bg` | `#08090A` | · | `--text` | `#D7E0E2` |
| `--panel` | `#0C0D0F` | · | `--dim` | `#8B989B` |
| `--panel-2` | `#101315` | · | `--mute` | `#525C61` |
| `--inset` | `#060708` | · | `--accent` | `#3DD6C4` |
| `--sel` | `#0E1315` | · | `--accent-text` | `#8AEDE2` |
| `--border` | `#171A1D` | · | `--accent-soft` | `rgba(61,214,196,.12)` |
| `--border-strong` | `#23282C` | · | `--radius` | `3px` |
| `--glow` | `none` | · | `--row-pad` | `8px 12px` |

Shared/data tokens (inherited by each theme, fine-tunable): `--info-soft rgba(77,163,255,.15)`·`--info-text #9CC9FF`; `--warn-soft rgba(240,178,62,.15)`·`--warn-text #F0C97A`; agent dot colors `--ag-claude #2DD4A7` `--ag-codex #9B8CFF` `--ag-gemini #4DA3FF` `--ag-qwen #F0B23E` `--ag-opencode #E8744A` `--ag-cursor #8A93A0`. Terminal-specific structure: monospace title, selected row `border-left:2px var(--accent)`, `--radius:3px`.

### Token contract (the binding interface for multiple themes)
**Components only use `var(--token)`, never hardcode colors, and never use a `dark ? a : b` JS ternary.** Tokens are split into two layers, and **a theme only swaps the color layer, never touches the structure layer** (otherwise you get "row height/font changes when switching themes" bugs — a pitfall we hit in practice: early on, putting radius/font into the theme block caused row-height jumps when switching themes):
- **Color layer** (overridden by each `[data-theme]` block): bg / panel / panel-2 / inset / sel · border / border-strong · text / dim / mute · accent / accent-text / accent-soft.
- **Structure layer** (fixed in the global `:root`, must not be changed by themes): titlefont · font-ui / font-mono · radius · glow · spacing (row-pad). Font metrics affect row height, so `.row-title`/`.row-meta` must also **pin `line-height`**, making row height independent of the font and constant across themes.
- **Semantic/data colors**: info-* / warn-* / ag-* (global).

### Multi-theme architecture
- **Switching = flipping a root attribute** `data-theme="terminal"` (the prototype's `[data-variant]` already verified this). Adding a theme = adding one set of **color** tokens, with zero component changes; **structure tokens do not go into the theme block** (see the contract above).
- **Theme source**: `renderer/themes/<id>.ts` exports a **typed token object** (aligned to the contract; type-checks for missing tokens) → injected as CSS variables into `:root[data-theme=<id>]`. Single source, verifiable.
- **Built-in themes**: Terminal (default) · Graphite (the Linear family) · Spotlight (the Raycast family) — the three prototype sets land directly as built-ins; light counterparts such as Terminal-Light to follow.
- **Persistence + flash prevention**: the choice is stored in settings (owned by the app; not lost on reindex); **before the first frame**, preload/main reads it inline and sets `data-theme`, preventing FOUC.
- **Follow system (Auto)**: `auto` switches between the theme's dark/light pair based on `nativeTheme.shouldUseDarkColors` (requires that the theme has a light variant; Terminal is dark-only for now → Auto temporarily equals terminal).
- **Accent follows the system accent color (optional toggle)**: `systemPreferences.getAccentColor()` overrides `--accent` as a dynamic token; by default the theme's built-in accent is used.
- **Custom themes (future)**: a theme is just a token map, so dropping one into `~/.agent-summa/themes/*.json` is enough to add a user theme — very much to a developer's taste; listed as a follow-up.
- **shadcn components also follow the same CSS-variable contract** (baseColor zinc / custom), with no separate palette; they change along with the theme switch.
- **Density**: dev tools tend to be dense — row padding `8–9px`, base 12–13px.

---

## Native-feel constraints (get as close as possible within Electron)

> The architecture is Electron (the decision tree confirmed this is correct — not a native shell). Below are the cheap main/renderer choices that determine "does it look like a native app within 30 seconds." Cites the native-conventions audit (ref 06) + tenets. Window mechanics follow mature Electron desktop practice; visuals follow the section above.

### BrowserWindow configuration (mature Electron desktop mechanics + agent-summa adjustments)
```ts
// app/src/main/window.ts
const win = new BrowserWindow({
  width: 1400, height: 900, minWidth: 1040, minHeight: 640,
  show: false,                              // show only on ready-to-show, to prevent a white-screen flash
  title: 'agent-summa',
  backgroundColor: '#0F1318',               // dark, set before the first frame → prevents FOUC
  ...(isMac && {
    titleBarStyle: 'hiddenInset',           // real traffic lights (don't hand-draw them)
    trafficLightPosition: { x: 16, y: 14 },
    roundedCorners: true,                   // OS draws the rounded corners; don't use CSS border-radius
    // vibrancy: 'sidebar',                  // dev-leaning translucent left rail (optional; has edge-case issues, opaque first is fine)
  }),
  ...(isWin && {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#141920', symbolColor: '#98A2B3', height: 34 }, // real controls on the right
    // backgroundMaterial: 'mica',           // optional; if it flickers, use a solid color
  }),
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
});
win.once('ready-to-show', () => win.show());
win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
// + single instance: app.requestSingleInstanceLock() → second-instance focuses the existing window
// + remember window bounds (across launches, multi-monitor); panel widths already planned for persistence
// + nativeTheme follows the system; systemPreferences.getAccentColor() feeds accent; electron-updater auto-update
```

### Checklist (P0 first, P1/P2 to follow)
- [ ] **P0** Real window chrome: the `hiddenInset`/`titleBarOverlay` above; **do not hand-draw the title bar/traffic lights**; leave window rounded corners + shadow to the OS (the renderer adds no window-level `border-radius`/`box-shadow`).
- [ ] **P0** Platform conditionals: mac controls on the left / Windows on the right.
- [ ] **P0** List rows have **no `cursor:pointer`** (keep a subtle hover background); chrome text is `user-select:none`, only the content area is selectable.
- [ ] **P0** Native context menu: intercept context-menu to pop an Electron `Menu` or disable it (don't expose the Chromium menu).
- [ ] **P0** System-font chrome + monospace technical tokens (see the visual section); **no Web fonts**.
- [ ] **P1** Keyboard = muscle memory (T7): `↑↓` selection · `Enter`=Resume/open · `⌘K` palette · `Esc` close · list type-ahead · `⌘F` search · all reachable via `Tab` · platform focus ring. Default selection = most recently active item (so "open and hit enter" holds).
- [ ] **P1** System notifications: scan complete/error go through the OS `Notification`; in-app toast (sonner) is reserved only for immediate contextual feedback.
- [ ] **P1** Settings: ideally a standalone native window (`⌘,`); for MVP a `/settings` route is acceptable (noting this).
- [ ] **P2** No-router cross-fade (list↔detail is a direct cut).
- [ ] **P2** Loading: no skeleton screens; cold scan (a few seconds) → spinner/progress, incremental rescan (<200ms) → show nothing; empty state minimal (icon + one line).
- [ ] **P2** Virtual-list scroll restoration (preserve position when going back and forth between list↔detail).
- [ ] **P2** Follow system accent color/material (vibrancy/mica optional, per the visual section).

> If a global hotkey to summon / tray residency is added later: a hidden WebView gets throttled → at that point see ref 03 (webview-survival).
