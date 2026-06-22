import type { CanonicalSession, SessionHead } from "./model";

export interface DetectionResult {
  installed: boolean;
  version?: string;
  evidence: string[];
}

export interface WriteOptions {
  force: boolean;
}

/** Structured resume command (program + args, never a shell string) → no injection. */
export interface ResumeCommand {
  program: string;
  args: string[];
  cwd?: string;
  /** When true, the provider has no id-addressable resume — UI should degrade (open app / copy). */
  displayOnly?: boolean;
}

export interface WrittenSession {
  paths: string[];
  sessionId: string;
  resumeCommand: ResumeCommand;
  backupPath?: string;
}

/** One implementation per agent. */
export interface Provider {
  readonly name: string;
  readonly slug: string; // stable kebab-case, == DB provider_slug
  readonly cliAlias: string;

  detect(): DetectionResult;
  sessionRoots(): string[];
  skillsDir(): string | undefined;

  /** Enumerate logical session paths. Default = walk roots; db-backed providers override. */
  list(): string[];
  ownsPath(path: string): boolean;

  /** Cheap metadata via bounded head/tail read — never streams the whole file. */
  readHead(path: string): SessionHead;
  /** Full parse into canonical IR (transcript viewer / search / fork) — P1. */
  read?(path: string): CanonicalSession;

  write?(session: CanonicalSession, opts: WriteOptions): WrittenSession;

  resumeCmd(sessionId: string, logicalPath: string, workspace?: string): ResumeCommand;
}

const ALIAS: Record<string, string> = {
  claude: "claude-code",
  cc: "claude-code",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  pi: "omp",
  "oh-my-pi": "omp",
};

export class ProviderRegistry {
  constructor(private readonly providers: Provider[]) {}

  all(): Provider[] {
    return this.providers;
  }
  installed(): Provider[] {
    return this.providers.filter((p) => p.detect().installed);
  }
  bySlug(slug: string): Provider | undefined {
    return this.providers.find((p) => p.slug === slug);
  }
  byAlias(alias: string): Provider | undefined {
    const canon = ALIAS[alias] ?? alias;
    return this.providers.find((p) => p.cliAlias === canon || p.slug === canon);
  }
  ownerOf(path: string): Provider | undefined {
    return this.providers.find((p) => p.ownsPath(path));
  }
}
