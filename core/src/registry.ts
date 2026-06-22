import { ProviderRegistry } from "./provider";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexProvider } from "./providers/codex";
import { GeminiProvider, QwenProvider } from "./providers/gemini";
import { OhMyPiProvider } from "./providers/oh-my-pi";
import { OpencodeProvider } from "./providers/opencode";

/** Static, deterministic registry of built-in providers. More land here as they're implemented. */
export function builtinRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    new ClaudeCodeProvider(),
    new CodexProvider(),
    new GeminiProvider(),
    new QwenProvider(),
    new OpencodeProvider(),
    new OhMyPiProvider(),
  ]);
}
