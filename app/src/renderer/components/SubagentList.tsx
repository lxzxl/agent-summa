import { useT } from "../i18n";
import { fmtTs } from "../lib/format";
import type { SubagentRow, SubagentsResult } from "@shared/ipc";

/** Sub-agent list grouped by workflow (Task spawns ungrouped first). */
export function SubagentList({ data, onPick }: { data: SubagentsResult; onPick: (r: SubagentRow) => void }): JSX.Element {
  const t = useT();
  const groups = new Map<string, SubagentRow[]>();
  for (const it of data.items) {
    const k = it.workflowId ?? "__task__";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  return (
    <div className="sub-wrap">
      {[...groups.entries()].map(([k, items]) => (
        <div key={k}>
          <div className="sub-group">{k === "__task__" ? t("sub.taskGroup", { n: items.length }) : `▸ ${k} · ${items.length}`}</div>
          {items.map((it) => (
            <button className="sub-row" key={it.path} onClick={() => onPick(it)}>
              <span className="sub-label">{it.label ?? t("sub.untitled")}</span>
              <span className="sub-meta">
                {it.rounds}⟳ · {fmtTs(it.endedAt)}
              </span>
            </button>
          ))}
        </div>
      ))}
      {data.truncated && <div className="tx-status">{t("sub.truncated", { n: data.items.length, total: data.total })}</div>}
    </div>
  );
}
