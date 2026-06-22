// Per-agent brand colors + logos. Deep-import only the SVG color/mono variants — avoids dragging
// the lib's antd-based helper components (ProviderIcon/Combine/…) into the bundle.
import ClaudeCodeIcon from "@lobehub/icons/es/ClaudeCode/components/Color";
import CodexIcon from "@lobehub/icons/es/Codex/components/Color";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import GeminiIcon from "@lobehub/icons/es/GeminiCLI/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import QwenIcon from "@lobehub/icons/es/Qwen/components/Color";

export const AGENT_COLOR: Record<string, string> = {
  "claude-code": "#2DD4A7",
  codex: "#9B8CFF",
  gemini: "#4DA3FF",
  qwen: "#F0B23E",
  opencode: "#E8744A",
  cursor: "#8A93A0",
  omp: "#9b4dff",
};

const AGENT_ICON: Record<string, { Icon: typeof ClaudeCodeIcon; mono?: boolean }> = {
  "claude-code": { Icon: ClaudeCodeIcon },
  codex: { Icon: CodexIcon },
  gemini: { Icon: GeminiIcon },
  qwen: { Icon: QwenIcon },
  cursor: { Icon: CursorIcon, mono: true }, // mono logo → tint with the agent color
  opencode: { Icon: OpenCodeIcon, mono: true },
};

// omp (oh-my-pi) has no @lobehub mark — render its own brand glyph: the signature gradient π
// (from omp's official favicon, github.com/can1357/oh-my-pi). Self-contained gradient, no tint.
function OmpIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
      <defs>
        <linearGradient id="omp-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ed4abf" />
          <stop offset="0.5" stopColor="#9b4dff" />
          <stop offset="1" stopColor="#5ad8e6" />
        </linearGradient>
      </defs>
      <path fill="url(#omp-mark)" d="M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z" />
    </svg>
  );
}

/** Brand logo for an agent; falls back to a colored dot for unknown providers. */
export function AgentIcon({ slug, size = 15 }: { slug: string; size?: number }): JSX.Element {
  if (slug === "omp") return <OmpIcon size={size} />;
  const e = AGENT_ICON[slug];
  if (!e) return <span className="dot" style={{ background: AGENT_COLOR[slug] ?? "#888" }} />;
  return <e.Icon size={size} style={{ flexShrink: 0, ...(e.mono ? { color: AGENT_COLOR[slug] ?? "var(--dim)" } : {}) }} />;
}
