import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { AgentIcon } from "../lib/agents";
import { base, fmtFull, rel } from "../lib/format";
import { ContextMatrix } from "../components/ContextMatrix";
import { LearnedFacts } from "../components/LearnedFacts";
import { SubagentList } from "../components/SubagentList";
import { TranscriptView } from "../components/TranscriptView";
import type { AgentRow, ProjectMemory, SearchHit, SessionRow, SubagentRow, SubagentsResult, TranscriptResult } from "@shared/ipc";

/** Sessions view: filterable/searchable/groupable session list + detail (transcript · sub-agents · memory). */
export function SessionsView({
  agents,
  flash,
  reloadAgents,
}: {
  agents: AgentRow[];
  flash: (m: string, ms?: number) => void;
  reloadAgents: () => void;
}): JSX.Element {
  const t = useT();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<{ provider?: string; source?: string }>({});
  const [groupBy, setGroupBy] = useState<"none" | "project">("none");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [detailTab, setDetailTab] = useState<"transcript" | "subagents" | "memory">("transcript");
  const [childSel, setChildSel] = useState<SubagentRow | null>(null);
  const [subAgents, setSubAgents] = useState<SubagentsResult | null>(null);
  const [projMem, setProjMem] = useState<ProjectMemory | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // The transcript currently shown: a drilled-in sub-agent if any, else the selected session.
  const txPath = childSel?.path ?? selected?.sessionPath ?? null;
  const total = agents.reduce((n, a) => n + a.count, 0);

  useEffect(() => {
    window.api.sessions({ ...filter, limit: 800 }).then(setSessions);
  }, [filter]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const id = setTimeout(() => window.api.search(q, 60).then(setHits), 180);
    return () => clearTimeout(id);
  }, [query]);

  // Selecting a different session resets the drill-in + tab + cached children.
  useEffect(() => {
    setChildSel(null);
    setDetailTab("transcript");
    setSubAgents(null);
  }, [selected?.sessionPath]);

  // Reveal the selected session in the list (esp. after picking a search hit, which clears the query
  // and re-renders the list from the top): expand its group if collapsed, then scroll its row into view.
  // The row itself is already highlighted via `.row.sel`.
  useEffect(() => {
    if (!selected) return;
    if (groupBy === "project") {
      const key = selected.project ?? "(unknown)";
      setCollapsed((c) => {
        if (!c.has(key)) return c;
        const n = new Set(c);
        n.delete(key);
        return n;
      });
    }
    const id = setTimeout(() => {
      document.querySelector(`.rows [data-path="${selected.sessionPath}"]`)?.scrollIntoView({ block: "nearest" });
    }, 50); // after the query-clear / group-expand re-render settles
    return () => clearTimeout(id);
  }, [selected?.sessionPath, groupBy]);

  // Load the active transcript (sub-agent if drilled in, else the session).
  useEffect(() => {
    if (!txPath) {
      setTranscript(null);
      return;
    }
    setTranscript(null);
    setLoadingTx(true);
    let cancelled = false;
    window.api.transcript(txPath).then((r) => {
      if (!cancelled) {
        setTranscript(r);
        setLoadingTx(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [txPath]);

  // Lazily fetch the sub-agent list when its tab is first opened.
  useEffect(() => {
    if (detailTab === "subagents" && selected && selected.subagents > 0 && !subAgents) {
      window.api.subagents(selected.sessionPath).then(setSubAgents);
    }
  }, [detailTab, selected, subAgents]);

  // Project memory (instruction files + this cwd's learned store) — loaded when the Memory tab opens.
  function reloadProjMem(): void {
    if (selected) window.api.projectMemory(selected.project, selected.workspace).then(setProjMem);
  }
  useEffect(() => {
    if (detailTab === "memory" && selected && !childSel) {
      setProjMem(null);
      window.api.projectMemory(selected.project, selected.workspace).then(setProjMem);
    }
  }, [detailTab, selected, childSel]);

  const grouped = useMemo(() => {
    if (groupBy !== "project") return null;
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const k = s.project ?? "(unknown)";
      (map.get(k) ?? map.set(k, []).get(k)!).push(s);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [sessions, groupBy]);
  // Search results keep the project grouping (so the group name stays visible) when grouped mode is on.
  const groupedHits = useMemo(() => {
    if (!hits || groupBy !== "project") return null;
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const k = h.project ?? "(unknown)";
      (map.get(k) ?? map.set(k, []).get(k)!).push(h);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hits, groupBy]);
  const activeGroups = hits ? groupedHits : grouped; // the groups currently displayed (project mode)

  async function doResume(): Promise<void> {
    if (!selected) return;
    const r = await window.api.resume({ sessionId: selected.sessionId, provider: selected.provider, cwd: selected.workspace ?? undefined });
    flash(r.launched ? t("resume.launched", { cmd: r.command }) : r.ok ? t("resume.copyRun", { cmd: r.command }) : t("resume.notResumable"), 4000);
  }
  async function copyText(text: string, label: string): Promise<void> {
    await window.api.copy(text);
    flash(t("copy.done", { label }));
  }
  async function copyResumeCommand(): Promise<void> {
    if (!selected) return;
    const r = await window.api.resumeCommand({ sessionId: selected.sessionId, provider: selected.provider, cwd: selected.workspace ?? undefined });
    if (!r.command) return flash(t("resume.notResumable"));
    await copyText(r.cwd ? `cd ${JSON.stringify(r.cwd)} && ${r.command}` : r.command, t("label.command"));
  }
  async function doFork(target: string): Promise<void> {
    if (!selected) return;
    flash(t("fork.running", { target }));
    const r = await window.api.fork({ sessionPath: selected.sessionPath, targetSlug: target });
    if ("error" in r) return flash(t("fork.failed", { error: r.error }));
    flash(t("fork.done", { target: r.targetSlug, turns: r.turns, resume: r.resume }), 7000);
    reloadAgents();
    window.api.sessions({ ...filter, limit: 800 }).then(setSessions);
  }

  const Row = ({ s }: { s: SessionRow }): JSX.Element => (
    <button className={`row${selected?.sessionPath === s.sessionPath ? " sel" : ""}`} data-path={s.sessionPath} onClick={() => setSelected(s)}>
      <div className="row-top">
        <AgentIcon slug={s.provider} />
        <span className="row-title">{s.title ?? s.lastPrompt ?? t("sessions.untitled")}</span>
        {s.source === "app-code" && <span className="pill src-app">app</span>}
        {s.source === "vm" && <span className="pill src-vm">vm🔒</span>}
        {s.status === "active" && <span className="pill st-active">{t("status.live")}</span>}
        {s.status === "interrupted" && (
          <span className="pill st-interrupt" data-tip={t("status.interrupted.title")}>
            {t("status.interrupted")}
          </span>
        )}
        {s.status === "empty" && <span className="pill st-empty">{t("status.empty")}</span>}
        {s.status === "orphaned" && (
          <span className="pill st-orphan" data-tip={t("status.orphan.title")}>
            {t("status.orphan")}
          </span>
        )}
        {s.subagents > 0 && (
          <span className="pill st-sub" data-tip={t("status.sub.title", { n: s.subagents, wf: s.workflows ? t("status.sub.wf", { w: s.workflows }) : "" })}>
            ⊕ {s.subagents}
          </span>
        )}
      </div>
      <div className="row-meta">
        {base(s.project) ?? t("sessions.noProject")} · {s.model ?? "?"} ·{" "}
        <span data-tip={fmtFull(s.endedAt)}>{rel(s.endedAt)}</span> · <span data-tip={t("rounds.title", { n: s.rounds })}>{s.rounds}⟳</span>
      </div>
    </button>
  );

  function toggleGroup(proj: string): void {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(proj)) n.delete(proj);
      else n.add(proj);
      return n;
    });
  }
  const GroupHead = ({ proj, count }: { proj: string; count: number }): JSX.Element => (
    <button className="grp-head" onClick={() => toggleGroup(proj)}>
      <span className="grp-chevron">{collapsed.has(proj) ? "▸" : "▾"}</span>
      <span className="grp-name">{proj === "(unknown)" ? t("sessions.noProject") : base(proj)}</span>
      <span className="gct">{count}</span>
    </button>
  );
  // A search-result row (distinct from a session Row: shows the match `via` tag; click opens the session).
  const HitRow = ({ h }: { h: SearchHit }): JSX.Element => (
    <button
      className="row"
      onClick={() => {
        const s = sessions.find((x) => x.sessionPath === h.sessionPath);
        setQuery("");
        if (s) setSelected(s);
      }}
    >
      <div className="row-top">
        <AgentIcon slug={h.provider} />
        <span className="row-title">{h.title ?? t("sessions.untitled")}</span>
        <span className={`hit-via via-${h.via}`}>{t(`search.via.${h.via}`)}</span>
      </div>
      <div className="row-meta">{(base(h.project) ?? t("sessions.noProject")) + " · " + h.snip}</div>
    </button>
  );

  return (
    <>
      <div className="list">
        <div className="list-head">
          <div className="search">
            <span style={{ color: "var(--mute)" }}>⌕</span>
            <input placeholder={t("sessions.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="filt">
            <button className={`fchip${!filter.provider ? " on" : ""}`} onClick={() => setFilter((f) => ({ ...f, provider: undefined }))} data-tip={t("side.all")}>
              {t("side.all")} <span className="fct">{total}</span>
            </button>
            {agents.map((a) => (
              <button
                key={a.slug}
                className={`fchip${filter.provider === a.slug ? " on" : ""}`}
                onClick={() => setFilter((f) => ({ ...f, provider: f.provider === a.slug ? undefined : a.slug }))}
                data-tip={`${a.name} · ${a.count}`}
              >
                <AgentIcon slug={a.slug} size={14} />
                <span className="fct">{a.count}</span>
              </button>
            ))}
            <span className="filt-sep" />
            {(
              [
                ["cli", "source.cli"],
                ["app-code", "source.desktop"],
                ["vm", "source.vm"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`fchip${filter.source === k ? " on" : ""}`}
                onClick={() => setFilter((f) => ({ ...f, source: f.source === k ? undefined : k }))}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <div className="lc">
            <div className="seg">
              <button className={groupBy === "none" ? "on" : ""} onClick={() => setGroupBy("none")}>
                {t("sessions.group.time")}
              </button>
              <button className={groupBy === "project" ? "on" : ""} onClick={() => setGroupBy("project")}>
                {t("sessions.group.project")}
              </button>
            </div>
            {groupBy === "project" && activeGroups && activeGroups.length > 0 && (
              <button
                className="btn-ghost grp-toggle"
                data-tip={t("sessions.foldAll.title")}
                onClick={() => setCollapsed((c) => (activeGroups.every(([p]) => c.has(p)) ? new Set() : new Set(activeGroups.map(([p]) => p))))}
              >
                {activeGroups.every(([p]) => collapsed.has(p)) ? t("sessions.expandAll") : t("sessions.collapseAll")}
              </button>
            )}
            <span className="count" style={{ marginLeft: "auto" }}>
              {hits ? t("sessions.hits", { n: hits.length }) : t("sessions.count", { n: sessions.length })}
            </span>
          </div>
        </div>

        {hits && groupBy !== "project" ? (
          <div className="rows">
            {hits.map((h, i) => (
              <HitRow key={`${h.sessionPath}-${i}`} h={h} />
            ))}
          </div>
        ) : groupedHits ? (
          <div className="rows">
            {groupedHits.map(([proj, hs]) => (
              <div className="grp" key={proj}>
                <GroupHead proj={proj} count={hs.length} />
                {!collapsed.has(proj) && hs.map((h, i) => <HitRow key={`${h.sessionPath}-${i}`} h={h} />)}
              </div>
            ))}
          </div>
        ) : grouped ? (
          <div className="rows">
            {grouped.map(([proj, rows]) => (
              <div className="grp" key={proj}>
                <GroupHead proj={proj} count={rows.length} />
                {!collapsed.has(proj) && rows.map((s) => <Row key={s.sessionPath} s={s} />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="rows">
            {sessions.map((s) => (
              <Row key={s.sessionPath} s={s} />
            ))}
          </div>
        )}
      </div>

      <div className="detail">
        {selected ? (
          <>
            <div className="detail-head">
              {childSel ? (
                <>
                  <button className="crumb" onClick={() => setChildSel(null)}>
                    ← {selected.title ?? t("detail.back")}
                  </button>
                  <div className="detail-title">{childSel.label ?? t("sub.child")}</div>
                  <div className="chips">
                    <span className="chip">{childSel.kind === "workflow" ? `workflow ${childSel.workflowId}` : t("sub.taskChip")}</span>
                    <span className="chip">{childSel.rounds}⟳</span>
                  </div>
                  <div className="detail-time">
                    {fmtFull(childSel.startedAt)} → {fmtFull(childSel.endedAt)}
                  </div>
                </>
              ) : (
                <>
                  <div className="detail-title">{selected.title ?? selected.lastPrompt ?? t("sessions.untitled")}</div>
                  <div className="chips">
                    <span className="chip">
                      <AgentIcon slug={selected.provider} />
                      {selected.provider}
                      {selected.source !== "cli" ? `·${selected.source}` : ""}
                    </span>
                    {selected.model && <span className="chip">{selected.model}</span>}
                    {selected.workspace && <span className="chip">{selected.workspace}</span>}
                    <span className="chip">{selected.rounds}⟳</span>
                    {selected.status === "active" && <span className="chip st-active">{t("status.live")}</span>}
                    {selected.status === "interrupted" && <span className="chip st-interrupt">{t("status.interrupted.chip")}</span>}
                    {selected.status === "empty" && <span className="chip st-empty">{t("status.empty")}</span>}
                    {selected.status === "orphaned" && <span className="chip st-orphan">{t("status.orphan.chip")}</span>}
                  </div>
                  <div className="detail-time">
                    {fmtFull(selected.startedAt)} → {fmtFull(selected.endedAt)}
                  </div>
                  <div className="actions">
                    <button className="btn-resume" disabled={selected.source === "vm"} onClick={doResume}>
                      {t("detail.resume")}
                    </button>
                    <button className="btn-ghost" disabled={selected.source === "vm"} onClick={copyResumeCommand} data-tip={t("detail.copyCmd.title")}>
                      {t("detail.copyCmd")}
                    </button>
                    <button className="btn-ghost" onClick={() => copyText(selected.sessionPath, t("label.path"))} data-tip={selected.sessionPath}>
                      {t("detail.copyPath")}
                    </button>
                    <button className="btn-ghost" onClick={() => copyText(selected.sessionId, t("label.id"))} data-tip={selected.sessionId}>
                      {t("detail.copyId")}
                    </button>
                    {selected.source !== "vm" &&
                      (["codex", "claude-code"] as const)
                        .filter((tg) => tg !== selected.provider)
                        .map((tg) => (
                          <button
                            key={tg}
                            className="btn-ghost btn-fork"
                            onClick={() => doFork(tg)}
                            data-tip={t("detail.fork.title", { agent: tg === "codex" ? "Codex" : "Claude Code" })}
                          >
                            {t("detail.fork", { target: tg === "codex" ? "Codex" : "Claude" })}
                          </button>
                        ))}
                    <div className="seg tabs">
                      <button className={detailTab === "transcript" ? "on" : ""} onClick={() => setDetailTab("transcript")}>
                        {t("tab.transcript")}
                      </button>
                      {selected.subagents > 0 && (
                        <button className={detailTab === "subagents" ? "on" : ""} onClick={() => setDetailTab("subagents")}>
                          {t("tab.subagents", { n: selected.subagents })}
                          {selected.workflows > 0 ? ` · ${selected.workflows}wf` : ""}
                        </button>
                      )}
                      <button className={detailTab === "memory" ? "on" : ""} onClick={() => setDetailTab("memory")}>
                        {t("tab.memory")}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {!childSel && detailTab === "memory" ? (
              <div className="mem-pane">
                {!projMem ? (
                  <div className="empty">{t("common.loading")}</div>
                ) : (
                  <>
                    {projMem.scope ? (
                      <ContextMatrix scope={projMem.scope} flash={flash} onChanged={reloadProjMem} />
                    ) : (
                      <div className="empty">{t("mem.noProjectDir")}</div>
                    )}
                    {projMem.store ? <LearnedFacts storePath={projMem.store.path} /> : <div className="mem-note mem-pane-note">{t("mem.noLearned")}</div>}
                  </>
                )}
              </div>
            ) : !childSel && detailTab === "subagents" ? (
              subAgents ? (
                <SubagentList data={subAgents} onPick={setChildSel} />
              ) : (
                <div className="transcript">
                  <div className="tx-status">{t("sub.loading")}</div>
                </div>
              )
            ) : loadingTx ? (
              <div className="transcript">
                <div className="tx-status">{t("tx.loading")}</div>
              </div>
            ) : transcript && !transcript.ok ? (
              <div className="transcript">
                <div className="tx-status">
                  {transcript.reason === "vm-locked"
                    ? t("tx.vmLocked")
                    : transcript.reason === "unsupported"
                      ? t("tx.unsupported")
                      : transcript.reason === "not-found"
                        ? t("tx.notFound")
                        : t("tx.error", { reason: transcript.reason })}
                </div>
              </div>
            ) : transcript?.ok ? (
              <TranscriptView key={txPath} messages={transcript.messages} truncated={transcript.truncated} total={transcript.total} />
            ) : (
              <div className="transcript" />
            )}
          </>
        ) : (
          <div className="empty">{t("sessions.selectPrompt")}</div>
        )}
      </div>
    </>
  );
}
