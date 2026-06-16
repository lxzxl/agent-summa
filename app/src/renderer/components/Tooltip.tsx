import { useEffect, useState } from "react";

/** Lightweight global tooltip: one delegated listener over [data-tip] elements + a single floating
 *  node. Shows after a short delay — the native `title` tooltip is far too slow and unstyleable. */
export function Tooltip(): JSX.Element | null {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cur: Element | null = null;
    const reveal = (el: Element): void => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 56; // flip below the element when it's near the top edge
      const x = Math.max(80, Math.min(window.innerWidth - 80, r.left + r.width / 2));
      setTip({ text, x: Math.round(x), y: Math.round(below ? r.bottom + 8 : r.top - 8), below });
    };
    const clear = (): void => {
      if (timer) clearTimeout(timer);
      cur = null;
      setTip(null);
    };
    const onOver = (e: MouseEvent): void => {
      const el = (e.target as Element)?.closest?.("[data-tip]");
      if (!el || el === cur) return;
      cur = el;
      if (timer) clearTimeout(timer);
      setTip(null);
      timer = setTimeout(() => reveal(el), 200);
    };
    const onOut = (e: MouseEvent): void => {
      if (!cur) return;
      const to = (e.relatedTarget as Element | null)?.closest?.("[data-tip]");
      if (to !== cur) clear();
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("mousedown", clear, true);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("mousedown", clear, true);
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className={`tip${tip.below ? " tip-below" : ""}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>
  );
}
