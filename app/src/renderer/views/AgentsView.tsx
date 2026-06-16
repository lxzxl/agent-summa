import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { AgentIcon } from "../lib/agents";
import { AgentConfig } from "../components/AgentConfig";
import type { AgentRow } from "@shared/ipc";

/** Agents view: list of agents → per-agent config (install/version/home/counts + global instructions). */
export function AgentsView({ agents, flash, reloadAgents }: { agents: AgentRow[]; flash: (m: string) => void; reloadAgents: () => void }): JSX.Element {
  const t = useT();
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!sel && agents.length) setSel(agents[0]!.slug);
  }, [sel, agents]);

  return (
    <>
      <div className="list">
        <div className="list-head">
          <div className="lc">
            <span className="count">{t("agents.count", { n: agents.length })}</span>
          </div>
        </div>
        <div className="rows">
          {agents.map((a) => (
            <button key={a.slug} className={`agent-row${sel === a.slug ? " sel" : ""}`} onClick={() => setSel(a.slug)}>
              <AgentIcon slug={a.slug} size={18} />
              <div className="agent-row-main">
                <span className="agent-row-name">{a.name}</span>
                <span className="agent-row-meta">{t("agent.sessions", { n: a.count })}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="detail">
        {sel ? <AgentConfig slug={sel} flash={flash} onChanged={reloadAgents} /> : <div className="empty">{t("agents.selectPrompt")}</div>}
      </div>
    </>
  );
}
