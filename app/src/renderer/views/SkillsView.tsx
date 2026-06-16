import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { AgentIcon } from "../lib/agents";
import { parseFm, splitSkillMd } from "../lib/frontmatter";
import { MarkdownBody } from "../components/MarkdownBody";
import type { AgentRow, SkillDetail, SkillRow } from "@shared/ipc";

/** Skills view: central-library skill × agent matrix, distribute / install / remove, SKILL.md detail. */
export function SkillsView({ agents, flash }: { agents: AgentRow[]; flash: (m: string) => void }): JSX.Element {
  const t = useT();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [skillTargets, setSkillTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [info, setInfo] = useState<SkillDetail | null>(null);

  const reload = (): Promise<void> => window.api.skills().then(setSkills);
  useEffect(() => {
    reload();
    window.api.skillTargets().then(setSkillTargets);
  }, []);

  function selectSkill(name: string): void {
    setSel(name);
    setInfo(null);
    window.api.skillDetail(name).then(setInfo);
  }
  async function doSpread(name: string): Promise<void> {
    setBusy(name);
    const r = await window.api.skillSpread(name);
    setBusy(null);
    if (r.error) return flash(t("spread.failed", { error: r.error }));
    flash(r.linked > 0 ? t("spread.done", { name, n: r.linked }) : t("spread.allHave"));
    reload();
  }
  async function doInstall(name: string, agent: string): Promise<void> {
    setBusy(name);
    const r = await window.api.skillInstall(name, agent);
    setBusy(null);
    if (r.error) return flash(t("install.failed", { error: r.error }));
    flash(r.linked > 0 ? t("install.done", { name, agent }) : t("install.already", { name, agent }));
    reload();
  }
  async function doRemove(name: string, agent: string): Promise<void> {
    if (!window.confirm(t("remove.confirm", { name, agent }))) return;
    setBusy(name);
    const r = await window.api.skillRemove(name, agent);
    setBusy(null);
    if (r.error) return flash(t("remove.failed", { error: r.error }));
    flash(r.removed ? (r.wasLink ? t("remove.doneLink", { agent }) : t("remove.doneFile", { agent })) : t("remove.notFound"));
    reload();
  }
  async function doRemoveAll(name: string): Promise<void> {
    if (!window.confirm(t("removeAll.confirm", { name }))) return;
    setBusy(name);
    const r = await window.api.skillRemoveAll(name);
    setBusy(null);
    flash(t("removeAll.done", { name, n: r.removed }));
    reload();
  }
  async function uninstallLinks(): Promise<void> {
    const r = await window.api.skillUninstall();
    flash(t("uninstallLinks.done", { n: r.removed }));
    reload();
  }

  return (
    <>
      <div className="list">
        <div className="list-head">
          <div className="search">
            <span style={{ color: "var(--mute)" }}>⌕</span>
            <input placeholder={t("skills.filter")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="filt">
            <button className={`fchip${!agentFilter ? " on" : ""}`} onClick={() => setAgentFilter(null)} data-tip={t("side.all")}>
              {t("side.all")}
            </button>
            {agents.map((a) => (
              <button
                key={a.slug}
                className={`fchip${agentFilter === a.slug ? " on" : ""}`}
                onClick={() => setAgentFilter((s) => (s === a.slug ? null : a.slug))}
                data-tip={t("skills.filterByAgent", { agent: a.name })}
              >
                <AgentIcon slug={a.slug} size={14} />
              </button>
            ))}
          </div>
          <div className="lc">
            <span className="count">{t("skills.count", { n: skills.length })}</span>
            <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={uninstallLinks} data-tip={t("skills.uninstallLinks.title")}>
              {t("skills.uninstallLinks")}
            </button>
          </div>
        </div>
        <div className="rows">
          {skills
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .filter((sk) => {
              const q = query.trim().toLowerCase();
              const matchesQ = !q || sk.name.toLowerCase().includes(q) || (sk.description ?? "").toLowerCase().includes(q);
              return matchesQ && (!agentFilter || sk.agents.includes(agentFilter));
            })
            .map((sk) => {
              const have = new Set(sk.agents);
              return (
                <div className={`skill-row${sel === sk.name ? " sel" : ""}`} key={sk.name} onClick={() => selectSkill(sk.name)}>
                  <div className="sk-row-name">
                    <span className="sk-name">{sk.name}</span>
                    {sk.conflict && (
                      <span className="sk-warn" data-tip={t("skill.conflict.title")}>
                        ⚠
                      </span>
                    )}
                  </div>
                  <div className="sk-row-desc">{sk.description || t("skill.noDesc")}</div>
                  <div className="sk-dots" data-tip={sk.agents.join(", ")}>
                    {skillTargets.map((tg) => (
                      <span
                        className={`sk-dot${have.has(tg) ? " on" : ""}`}
                        key={tg}
                        data-tip={t("skill.dot.title", { agent: tg, state: have.has(tg) ? t("skill.installed") : t("skill.notInstalled") })}
                      >
                        <AgentIcon slug={tg} size={15} />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div className="detail">
        {!sel ? (
          <div className="empty">{t("skills.selectPrompt")}</div>
        ) : !info || info.name !== sel ? (
          <div className="empty">{t("common.loading")}</div>
        ) : (
          (() => {
            const have = new Set(info.installs.map((i) => i.agent));
            const missing = skillTargets.filter((tg) => !have.has(tg));
            const meta = parseFm(splitSkillMd(info.skillMd).frontmatter).filter((e) => e.key !== "name" && e.key !== "description" && e.value);
            return (
              <>
                <div className="detail-head">
                  <div className="detail-title">{info.name}</div>
                  {info.description && <div className="sk-d-desc">{info.description}</div>}
                  {meta.length > 0 && (
                    <div className="sk-meta">
                      {meta.map((e) => (
                        <div className="sk-meta-row" key={e.key}>
                          <span className="sk-meta-k">{e.key}</span>
                          <span className="sk-meta-v">{e.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="sk-d-matrix">
                    {skillTargets.map((tg) =>
                      have.has(tg) ? (
                        <button className="sk-cell installed" key={tg} disabled={busy === sel} onClick={() => doRemove(sel, tg)} data-tip={t("skill.cell.installed.title", { agent: tg })}>
                          <AgentIcon slug={tg} size={16} />
                          <span>{tg}</span>
                        </button>
                      ) : (
                        <button className="sk-cell missing" key={tg} disabled={busy === sel} onClick={() => doInstall(sel, tg)} data-tip={t("skill.cell.missing.title", { agent: tg })}>
                          <AgentIcon slug={tg} size={16} />
                          <span>{tg}</span>
                        </button>
                      ),
                    )}
                  </div>
                  <div className="actions">
                    {missing.length > 0 && (
                      <button className="btn-resume" disabled={busy === sel} onClick={() => doSpread(sel)} data-tip={t("skill.spread.title", { n: missing.length, agents: missing.join(", ") })}>
                        {t("skill.spread", { n: missing.length })}
                      </button>
                    )}
                    <button className="btn-ghost" disabled={busy === sel} onClick={() => doRemoveAll(sel)} data-tip={t("skill.uninstallAll.title")}>
                      {t("skill.uninstallAll")}
                    </button>
                  </div>
                </div>
                <div className="sk-detail-body">
                  <div className="sk-d-label">{t("skill.installMethods")}</div>
                  <div className="sk-d-installs">
                    {info.installs.map((i) => (
                      <div className="sk-d-inst" key={i.path}>
                        <AgentIcon slug={i.agent} size={13} />
                        <span className="sk-d-agent">{i.agent}</span>
                        <span className={`sk-d-type ${i.type}`}>{i.type === "link" ? t("skill.type.link") : t("skill.type.dir")}</span>
                        {i.managed && (
                          <span className="sk-d-managed" data-tip={t("skill.managed.title")}>
                            summa
                          </span>
                        )}
                        <span className="sk-d-path" data-tip={i.target ? `${i.path} → ${i.target}` : i.path}>
                          {i.type === "link" && i.target ? `→ ${i.target}` : i.path}
                        </span>
                      </div>
                    ))}
                  </div>
                  {info.source && (
                    <div className="sk-d-source">
                      {t("skill.source")}
                      <code>{info.source}</code>
                    </div>
                  )}
                  {(() => {
                    const body = splitSkillMd(info.skillMd).body;
                    return body ? (
                      <>
                        <div className="sk-d-label">SKILL.md</div>
                        <div className="sk-d-md">
                          <MarkdownBody text={body} />
                        </div>
                      </>
                    ) : null;
                  })()}
                </div>
              </>
            );
          })()
        )}
      </div>
    </>
  );
}
