import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";
import { I18nContext, LOCALES, type Locale, type TFn, loadLocale, makeT } from "./i18n";
import { COLS_KEY, DEFAULT_THEME, RAIL, THEMES, loadCols } from "./lib/layout";
import { clamp } from "./lib/format";
import { Tooltip } from "./components/Tooltip";
import { SessionsView } from "./views/SessionsView";
import { SkillsView } from "./views/SkillsView";
import { AgentsView } from "./views/AgentsView";
import type { AgentRow, FtsProgress, ScanResult, UpdateInfo } from "@shared/ipc";

/** App shell: theme/locale/layout + the activity rail + view routing + the settings modal.
 *  Each view (Sessions/Skills/Agents) is self-contained and owns its own state. */
export function App(): JSX.Element {
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [nav, setNav] = useState<"sessions" | "skills" | "agents">("sessions");
  const [scanInfo, setScanInfo] = useState<ScanResult | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cols, setCols] = useState(loadCols);
  const [toast, setToast] = useState("");
  const [locale, setLocale] = useState<Locale>(loadLocale);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fts, setFts] = useState<FtsProgress | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const t = useMemo<TFn>(() => makeT(locale), [locale]);

  const reloadAgents = (): void => {
    window.api.agents().then(setAgents);
  };
  function flash(msg: string, ms = 2000): void {
    setToast(msg);
    setTimeout(() => setToast(""), ms);
  }
  async function doCheckUpdate(): Promise<void> {
    setChecking(true);
    setUpdate(await window.api.checkForUpdate());
    setChecking(false);
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  }, [cols]);
  useEffect(() => {
    localStorage.setItem("asum.locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    (async () => {
      setScanInfo(await window.api.scan());
      reloadAgents();
    })();
  }, []);
  // Background FTS-indexing progress (pushed from the worker via main); auto-clear shortly after done.
  useEffect(
    () =>
      window.api.onFtsProgress((p) => {
        setFts(p);
        if (p.type === "done" || p.type === "error") setTimeout(() => setFts(null), 2500);
      }),
    [],
  );
  // Quiet update check on launch — only surfaces a notice when a newer release exists.
  useEffect(() => {
    window.api.checkForUpdate().then((u) => {
      if (u.ok && u.hasUpdate) setUpdate(u);
    });
  }, []);

  // Drag the list↔detail divider: capture width at mousedown, update live until mouseup.
  function startResize(e: ReactMouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const start = cols.list;
    const move = (ev: MouseEvent): void => setCols({ list: clamp(start + (ev.clientX - startX), 220, 640) });
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("dragging");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("dragging");
  }

  return (
    <I18nContext.Provider value={t}>
      <div className="app">
        <div className="titlebar">
          <span className="brand">agent-summa</span>
          <button className="tbtn" style={{ marginLeft: "auto" }} data-tip={t("titlebar.rescan")} onClick={() => window.api.scan().then(setScanInfo)}>
            ↻
          </button>
        </div>

        <div className="body" style={{ gridTemplateColumns: `${RAIL}px ${cols.list}px minmax(0, 1fr)` }}>
          <div className="resize-h" style={{ left: RAIL + cols.list }} onMouseDown={startResize} />

          <div className="rail">
            {(
              [
                ["sessions", "nav.sessions", "☰"],
                ["skills", "nav.skills", "❖"],
                ["agents", "nav.agents", "⬡"],
              ] as const
            ).map(([k, label, ic]) => (
              <button key={k} className={`rail-item${nav === k ? " active" : ""}`} onClick={() => setNav(k)} data-tip={t(label)}>
                <span className="rail-ic">{ic}</span>
                <span className="rail-lb">{t(label)}</span>
              </button>
            ))}
            <button className="rail-item rail-bottom" onClick={() => setSettingsOpen(true)} data-tip={t("settings.title")}>
              <span className="rail-ic">⚙</span>
              <span className="rail-lb">{t("settings.title")}</span>
            </button>
          </div>

          {nav === "skills" ? (
            <SkillsView agents={agents} flash={flash} />
          ) : nav === "agents" ? (
            <AgentsView agents={agents} flash={flash} reloadAgents={reloadAgents} />
          ) : (
            <SessionsView agents={agents} flash={flash} reloadAgents={reloadAgents} />
          )}
        </div>

        <div className="statusbar">
          <span>
            {scanInfo ? t("statusbar.scan", { count: scanInfo.count, appCode: scanInfo.appCode, vm: scanInfo.vmLocked }) : t("statusbar.scanning")}
          </span>
          {fts && (fts.type === "start" || fts.type === "progress") ? (
            <span className="idx-status">
              <span className="idx-spin">⟳</span>
              {t("idx.progress", { done: fts.type === "progress" ? fts.done : 0, total: fts.total })}
            </span>
          ) : fts && fts.type === "done" && fts.total > 0 ? (
            <span className="idx-status idx-done">{t("idx.done", { n: fts.indexed })}</span>
          ) : null}
          {update?.ok && update.hasUpdate ? (
            <span
              className="idx-status idx-done"
              style={{ cursor: "pointer" }}
              data-tip={t("update.download", { v: update.latest ?? "" })}
              onClick={() => {
                if (update.url) void window.api.openExternal(update.url);
              }}
            >
              ↑ {t("update.available", { v: update.latest ?? "" })}
            </span>
          ) : null}
          <span style={{ marginLeft: "auto" }}>{toast || t("statusbar.agents", { n: agents.length })}</span>
        </div>

        <Tooltip />

        {settingsOpen && (
          <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <span>{t("settings.title")}</span>
                <button className="tbtn" data-tip={t("settings.close")} onClick={() => setSettingsOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="modal-row">
                <span className="modal-label">{t("settings.language")}</span>
                <div className="seg">
                  {LOCALES.map((l) => (
                    <button key={l.id} className={locale === l.id ? "on" : ""} onClick={() => setLocale(l.id)}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-row stack">
                <span className="modal-label">{t("settings.theme")}</span>
                <div className="theme-opts">
                  {THEMES.map((th) => (
                    <button key={th.id} className={`theme-opt${theme === th.id ? " on" : ""}`} onClick={() => setTheme(th.id)}>
                      {th.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-row">
                <span className="modal-label">{t("settings.updates")}</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button className="btn-ghost" disabled={checking} onClick={doCheckUpdate}>
                    {checking ? t("update.checking") : t("update.check")}
                  </button>
                  {!checking && update?.ok && update.hasUpdate ? (
                    <button className="btn-resume" onClick={() => update.url && void window.api.openExternal(update.url)}>
                      {t("update.download", { v: update.latest ?? "" })}
                    </button>
                  ) : !checking && update ? (
                    <span style={{ color: "var(--dim)" }}>{update.ok ? t("update.upToDate", { v: update.current }) : t("update.failed")}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </I18nContext.Provider>
  );
}
