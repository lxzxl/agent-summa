import { useT } from "../i18n";
import { fmtTs } from "../lib/format";
import type { TranscriptMessage } from "@shared/ipc";
import { MarkdownBody } from "./MarkdownBody";

/** A single transcript message (user / assistant = markdown; tool = raw text). */
export function Msg({ m }: { m: TranscriptMessage }): JSX.Element {
  const t = useT();
  const label = m.role === "user" ? t("label.you") : m.role === "assistant" ? t("label.assistant") : m.role;
  return (
    <div className={`msg msg-${m.role}`}>
      <div className="msg-role">
        {label}
        {m.ts ? <span className="msg-ts">{fmtTs(m.ts)}</span> : null}
      </div>
      {m.text ? (
        // tool output is raw program text (file dumps / JSON / logs) — never markdown-parse it.
        m.role === "tool" ? <div className="msg-text">{m.text}</div> : <MarkdownBody text={m.text} />
      ) : null}
      {m.tools.length > 0 && (
        <div className="msg-tools">
          {m.tools.map((tool, i) => (
            <span className="tool-chip" key={i}>
              ⚙ {tool}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
