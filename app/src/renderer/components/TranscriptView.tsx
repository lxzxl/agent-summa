import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useT } from "../i18n";
import type { TranscriptMessage } from "@shared/ipc";
import { Msg } from "./Msg";

/** Virtualized transcript — dynamic row heights via measureElement, handles 1000s of messages. */
export function TranscriptView({
  messages,
  truncated,
  total,
}: {
  messages: TranscriptMessage[];
  truncated: boolean;
  total: number;
}): JSX.Element {
  const t = useT();
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 90,
    overscan: 10,
  });
  if (messages.length === 0) {
    return (
      <div className="transcript">
        <div className="tx-status">{t("tx.empty")}</div>
      </div>
    );
  }
  return (
    <div ref={parentRef} className="transcript">
      {truncated && <div className="tx-status">{t("tx.truncated", { n: messages.length, total })}</div>}
      <div className="tx-inner" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => (
          <div key={vi.key} data-index={vi.index} ref={v.measureElement} className="tx-item" style={{ transform: `translateY(${vi.start}px)` }}>
            <Msg m={messages[vi.index]!} />
          </div>
        ))}
      </div>
    </div>
  );
}
