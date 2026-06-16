import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectContextScope } from "../src/memory/scan";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asum-scan-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("projectContextScope", () => {
  it("flags divergence when instruction files differ in content", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "alpha instructions");
    writeFileSync(join(dir, "AGENTS.md"), "beta — totally different");
    const s = projectContextScope(dir);
    expect(s).toBeDefined();
    expect(s!.present).toBe(2);
    expect(s!.divergent).toBe(true);
  });

  it("is NOT divergent when a symlink mirrors the source (same resolved content)", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "shared content");
    symlinkSync(canonical, join(dir, "AGENTS.md"));
    const s = projectContextScope(dir);
    expect(s!.divergent).toBe(false); // hash of the link's target equals the source's
  });

  it("returns undefined for a project with no instruction files, unless keepEmpty", () => {
    expect(projectContextScope(dir)).toBeUndefined();
    const s = projectContextScope(dir, true);
    expect(s).toBeDefined();
    expect(s!.present).toBe(0);
    // CLAUDE.md / AGENTS.md / GEMINI.md / QWEN.md are always shown so missing files can be created
    expect(s!.slots.length).toBeGreaterThanOrEqual(4);
    expect(s!.canonical).toBeUndefined(); // nothing to be the source yet
  });

  it("picks the richest real file as the suggested canonical", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "short");
    writeFileSync(join(dir, "AGENTS.md"), "a much longer, richer instruction file body");
    const s = projectContextScope(dir)!;
    expect(s.canonical).toBe(join(dir, "AGENTS.md"));
  });
});
