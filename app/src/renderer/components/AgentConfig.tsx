import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { AgentIcon } from "../lib/agents";
import { base } from "../lib/format";
import type { AgentConfigInfo } from "@shared/ipc";

/** Per-agent config view (shown in the Agents view detail pane): install/version/home/counts +
 *  this agent's GLOBAL instruction file with link-to-source / unlink. */
export function AgentConfig({ slug, flash, onChanged }: { slug: string; flash: (m: string) => void; onChanged: () => void }): JSX.Element {
  const t = useT();
  const [cfg, setCfg] = useState<AgentConfigInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (): Promise<void> => window.api.agentConfig(slug).then(setCfg);
  useEffect(() => {
    setCfg(null);
    load();
  }, [slug]);
  if (!cfg) return <div className="empty">{t("common.loading")}</div>;

  const slot = cfg.globalSlot;
  const canonical = cfg.canonical;
  const isCanon = !!slot && !!canonical && slot.path === canonical;
  const foreign = !!slot && slot.isLink && !slot.managed;
  const slotState = !slot ? "" : isCanon ? "canon" : !slot.exists ? "missing" : slot.isLink ? "link" : slot.empty ? "empty" : "real";

  async function linkToSource(): Promise<void> {
    if (!slot || !canonical) return;
    if (slot.exists && !slot.empty && !(slot.isLink && slot.managed) && !window.confirm(t("mem.converge.confirm", { n: 1 }))) return;
    setBusy(true);
    const r = await window.api.contextConverge({ scope: "global", canonical, targets: [{ path: slot.path, agent: slug }] });
    setBusy(false);
    flash(r.errors.length ? t("mem.converge.failed", { error: r.errors[0] ?? "" }) : t("mem.converge.done", { n: r.linked, bak: r.backedUp.length }));
    await load();
    onChanged();
  }
  async function unlink(): Promise<void> {
    if (!slot || !window.confirm(t("mem.unlink.confirm"))) return;
    setBusy(true);
    const r = await window.api.contextUnlink(slot.path);
    setBusy(false);
    flash(r.removed ? (r.restored ? t("mem.unlink.restored") : t("mem.unlink.done")) : t("mem.unlink.failed", { error: r.error ?? "" }));
    await load();
    onChanged();
  }

  return (
    <>
      <div className="detail-head">
        <div className="detail-title">
          <AgentIcon slug={slug} size={18} /> {cfg.name}
        </div>
        <div className="chips">
          <span className={`chip ${cfg.installed ? "st-active" : "st-empty"}`}>{cfg.installed ? t("agent.installed") : t("agent.notInstalled")}</span>
          {cfg.version && <span className="chip">{cfg.version}</span>}
          <span className="chip">{t("agent.sessions", { n: cfg.sessions })}</span>
          <span className="chip">{t("agent.skills", { n: cfg.skills })}</span>
        </div>
        {cfg.home && <div className="detail-time">{cfg.home}</div>}
      </div>
      <div className="sk-detail-body">
        <div className="sk-d-label">{t("agent.globalInstr")}</div>
        {!slot ? (
          <div className="empty">{t("agent.noGlobalSlot")}</div>
        ) : (
          <div className="agent-instr">
            <div className="agent-instr-row">
              <code>{slot.path}</code>
              <span className={`sk-d-type ${slot.isLink ? "link" : "dir"}`}>
                {isCanon ? `★ ${t("mem.state.canon")}` : t(`mem.state.${slotState}`)}
                {foreign ? ` · ${t("mem.state.foreign")}` : ""}
              </span>
            </div>
            {slot.isLink && slot.linkTarget && <div className="agent-instr-target">→ {slot.linkTarget}</div>}
            <div className="actions">
              {isCanon ? (
                <span className="agent-instr-note">{t("agent.isSource", { file: base(canonical) ?? "" })}</span>
              ) : foreign ? (
                <span className="agent-instr-note">{t("agent.foreignNote")}</span>
              ) : !canonical ? (
                <span className="agent-instr-note">{t("agent.noSource")}</span>
              ) : slot.isLink && slot.managed ? (
                <button className="btn-ghost" disabled={busy} onClick={() => void unlink()}>
                  {t("agent.unlink")}
                </button>
              ) : (
                <button className="btn-resume" disabled={busy} onClick={() => void linkToSource()} data-tip={t("agent.linkSource.title", { file: base(canonical) ?? "" })}>
                  {t("agent.linkSource", { file: base(canonical) ?? "" })}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
