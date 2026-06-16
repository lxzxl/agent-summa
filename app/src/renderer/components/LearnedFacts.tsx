import { useEffect, useState } from "react";
import { useT } from "../i18n";
import type { MemoryStoreDetail } from "@shared/ipc";
import { MarkdownBody } from "./MarkdownBody";

/** Read-only learned-fact browse for one Claude memory store (MEMORY.md index + frontmatter facts). */
export function LearnedFacts({ storePath }: { storePath: string }): JSX.Element {
  const t = useT();
  const [detail, setDetail] = useState<MemoryStoreDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    window.api.memoryStoreRead(storePath).then(setDetail);
  }, [storePath]);
  if (!detail) return <div className="empty">{t("common.loading")}</div>;
  return (
    <div className="ctx-block">
      <div className="mem-note">{t("mem.learned.note")}</div>
      {detail.index && (
        <>
          <div className="sk-d-label">MEMORY.md</div>
          <div className="sk-d-md">
            <MarkdownBody text={detail.index} />
          </div>
        </>
      )}
      <div className="sk-d-label">{t("mem.factsLabel", { n: detail.facts.length })}</div>
      {detail.facts.map((f) => (
        <details className="mem-fact" key={f.file}>
          <summary>
            {f.type && <span className={`mem-type t-${f.type}`}>{f.type}</span>}
            <span className="mem-fact-name">{f.name}</span>
            <span className="mem-fact-desc">{f.description}</span>
          </summary>
          <div className="sk-d-md">
            <MarkdownBody text={f.body} />
          </div>
        </details>
      ))}
    </div>
  );
}
