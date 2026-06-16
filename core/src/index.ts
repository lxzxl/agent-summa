export * from "./model";
export * from "./provider";
export * from "./registry";
export { openDb, type DB } from "./index/db";
export { scan, type ScanStats } from "./index/scanner";
export { indexSession, rebuildFts, searchMessages, type SearchHit } from "./index/messages";
export { fork, type ForkResult } from "./fork";
export { scanSkills, skillRoots, parseFrontmatter, type SkillEntry } from "./skills/scan";
export { distributeSkills, spreadSkill, removeSkillDir, uninstallSkills, type Manifest, type DistTarget } from "./skills/distribute";
export { applyDesktopOverlay, readDesktopCatalog, type DesktopEntry } from "./providers/claude-desktop";
export { listSubagents, countSubagents, type SubagentRef } from "./providers/claude-code";
export { OpencodeProvider, applyOpencodeOverlay } from "./providers/opencode";
export { contextScopes, globalContextScope, projectContextScope, type ContextScope, type ContextSlot } from "./memory/scan";
export {
  convergeContext,
  unlinkContext,
  unlinkAllContext,
  readContextFile,
  type ContextManifest,
  type ContextDeploy,
  type ConvergeTarget,
} from "./memory/distribute";
export { listMemoryStores, readMemoryStore, addedMemories, type MemoryStore, type MemoryFact, type MemoryStoreDetail } from "./memory/facts";
