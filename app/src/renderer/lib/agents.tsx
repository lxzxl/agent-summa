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
};

const AGENT_ICON: Record<string, { Icon: typeof ClaudeCodeIcon; mono?: boolean }> = {
  "claude-code": { Icon: ClaudeCodeIcon },
  codex: { Icon: CodexIcon },
  gemini: { Icon: GeminiIcon },
  qwen: { Icon: QwenIcon },
  cursor: { Icon: CursorIcon, mono: true }, // mono logo → tint with the agent color
  opencode: { Icon: OpenCodeIcon, mono: true },
};

/** Brand logo for an agent; falls back to a colored dot for unknown providers. */
export function AgentIcon({ slug, size = 15 }: { slug: string; size?: number }): JSX.Element {
  const e = AGENT_ICON[slug];
  if (!e) return <span className="dot" style={{ background: AGENT_COLOR[slug] ?? "#888" }} />;
  return <e.Icon size={size} style={{ flexShrink: 0, ...(e.mono ? { color: AGENT_COLOR[slug] ?? "var(--dim)" } : {}) }} />;
}
