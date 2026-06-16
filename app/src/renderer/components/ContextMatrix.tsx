import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { AgentIcon } from "../lib/agents";
import { base } from "../lib/format";
import type { ContextScope, ContextSlot } from "@shared/ipc";
import { MarkdownBody } from "./MarkdownBody";

/** Reusable context-file convergence block: pick a source-of-truth and bring the other agents'
 *  instruction files in sync (symlink). One file = one row: who reads it · plain-language sync
 *  state · at most one explicit action. Embedded in the session detail's Memory tab. */
export function ContextMatrix({ scope, flash, onChanged }: { scope: ContextScope; flash: (m: string) => void; onChanged: () => void }): JSX.Element {
  const t = useT();
  const [canon, setCanon] = useState<string | null>(null);
  const [body, setBody] = useState<{ content: string; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const canonical = canon ?? scope.canonical ?? null;

  useEffect(() => {
    setCanon(null);
  }, [scope.id]);
  useEffect(() => {
    if (!canonical) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setBody(null);
    window.api.contextRead(canonical).then((b) => !cancelled && setBody(b));
    return () => {
      cancelled = true;
    };
  }, [canonical]);

  const canonSlot = scope.slots.find((s) => s.path === canonical);
  const canonHash = canonSlot?.hash;
  const real = scope.slots.filter((s) => s.exists && !s.empty && !s.isLink);
  // files that exist but whose content differs from the source → what "Sync all" fixes
  const convergable = canonical ? scope.slots.filter((s) => s.path !== canonical && s.exists && (!s.hash || s.hash !== canonHash)) : [];

  async function converge(targets: ContextSlot[]): Promise<void> {
    if (!canonical) return;
    const willBackup = targets.some((s) => s.exists && !s.empty && !(s.isLink && s.managed) && s.hash !== canonHash);
    if (willBackup && !window.confirm(t("mem.converge.confirm", { n: targets.length }))) return;
    setBusy(true);
    const r = await window.api.contextConverge({ scope: scope.id, canonical, targets: targets.map((s) => ({ path: s.path, agent: s.agents[0] ?? "?" })) });
    setBusy(false);
    flash(r.errors.length ? t("mem.converge.failed", { error: r.errors[0] ?? "" }) : t("mem.converge.done", { n: r.linked, bak: r.backedUp.length }));
    onChanged();
  }
  async function unlink(path: string): Promise<void> {
    if (!window.confirm(t("mem.unlink.confirm"))) return;
    setBusy(true);
    const r = await window.api.contextUnlink(path);
    setBusy(false);
    flash(r.removed ? (r.restored ? t("mem.unlink.restored") : t("mem.unlink.done")) : t("mem.unlink.failed", { error: r.error ?? "" }));
    onChanged();
  }

  // One file = one row: plain-language sync state + at most one explicit action.
  type RowInfo = { cls: string; label: string; act: { kind: "link" | "unlink" | "converge"; label: string } | null };
  function rowFor(s: ContextSlot): RowInfo {
    if (s.path === canonical) return { cls: "src", label: t("ctx.st.source"), act: null };
    if (!s.exists) return { cls: "off", label: t("ctx.st.missing"), act: { kind: "link", label: t("ctx.act.create") } };
    if (s.empty) return { cls: "off", label: t("ctx.st.empty"), act: { kind: "link", label: t("ctx.act.link") } };
    const synced = !!s.hash && !!canonHash && s.hash === canonHash;
    if (synced) {
      if (s.isLink && s.managed) return { cls: "ok", label: t("ctx.st.synced"), act: { kind: "unlink", label: t("ctx.act.unlink") } };
      if (s.isLink) return { cls: "ok", label: t("ctx.st.syncedYours"), act: null }; // your own link to the source — already fine
      return { cls: "ok", label: t("ctx.st.copy"), act: { kind: "link", label: t("ctx.act.link") } }; // identical separate copy
    }
    return { cls: "warn", label: s.isLink ? t("ctx.st.elsewhere") : t("ctx.st.differs"), act: { kind: "converge", label: t("ctx.act.converge") } };
  }

  return (
    <div className="ctx-block">
      {real.length > 1 && (
        <div className="ctx-src-line">
          <span className="ctx-src-k">{t("ctx.sourceOfTruth")}</span>
          <div className="seg">
            {real.map((s) => (
              <button key={s.path} className={canonical === s.path ? "on" : ""} onClick={() => setCanon(s.path)} data-tip={s.path}>
                {s.filename}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ctx-rows">
        {scope.slots.map((s) => {
          const r = rowFor(s);
          const act = r.act;
          return (
            <div className={`ctx-frow ctx-${r.cls}`} key={s.path}>
              <span className="ctx-fagents">
                {s.agents.map((a) => (
                  <AgentIcon key={a} slug={a} size={14} />
                ))}
              </span>
              <span className="ctx-fname" data-tip={s.isLink && s.linkTarget ? `${s.path} → ${s.linkTarget}` : s.path}>
                {r.cls === "src" ? "★ " : ""}
                {s.filename}
              </span>
              <span className="ctx-fstate">{r.label}</span>
              {act ? (
                <button
                  className={`ctx-fact ctx-act-${act.kind}`}
                  disabled={busy || (act.kind !== "unlink" && !canonical)}
                  onClick={() => (act.kind === "unlink" ? void unlink(s.path) : void converge([s]))}
                >
                  {act.label}
                </button>
              ) : (
                <span className="ctx-fact-none" />
              )}
            </div>
          );
        })}
      </div>

      {canonical && convergable.length > 0 && (
        <button className="btn-resume ctx-sync-all" disabled={busy} onClick={() => void converge(convergable)} data-tip={t("mem.converge.title", { n: convergable.length })}>
          {t("ctx.syncAll", { n: convergable.length, file: base(canonical) ?? "" })}
        </button>
      )}

      <div className="sk-d-label">
        {t("mem.preview")}
        {canonical ? `: ${base(canonical)}` : ""}
      </div>
      {!canonical ? (
        <div className="empty">{t("mem.noCanonical")}</div>
      ) : !body ? (
        <div className="empty">{t("common.loading")}</div>
      ) : body.content ? (
        <div className="sk-d-md">
          <MarkdownBody text={body.content} />
        </div>
      ) : (
        <div className="empty">{t("mem.emptyFile")}</div>
      )}
    </div>
  );
}
