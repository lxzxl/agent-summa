import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convergeContext, unlinkContext } from "../src/memory/distribute";

let dir: string;
let manifest: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asum-ctx-"));
  manifest = join(dir, "manifest.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const converge1 = (canonical: string, target: string, agent = "codex"): ReturnType<typeof convergeContext> =>
  convergeContext({ canonical, scope: "test", targets: [{ path: target, agent }], manifestPath: manifest, stamp: 123 });

describe("convergeContext", () => {
  it("backs up a divergent real file, then links it to the canonical source", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "SOURCE");
    const target = join(dir, "AGENTS.md");
    writeFileSync(target, "OLD DIFFERENT");
    const r = converge1(canonical, target);
    expect(r.linked).toBe(1);
    expect(r.backedUp).toHaveLength(1);
    expect(isLink(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("SOURCE"); // now reads the source's content
    expect(readFileSync(`${target}.summa-bak-123`, "utf8")).toBe("OLD DIFFERENT"); // original preserved
  });

  it("replaces an identical file without making a backup", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "SAME");
    const target = join(dir, "AGENTS.md");
    writeFileSync(target, "SAME");
    const r = converge1(canonical, target);
    expect(r.linked).toBe(1);
    expect(r.backedUp).toHaveLength(0); // identical → nothing worth backing up
    expect(isLink(target)).toBe(true);
  });

  it("creates a missing target as a link", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "X");
    const target = join(dir, "GEMINI.md"); // does not exist
    const r = converge1(canonical, target);
    expect(r.linked).toBe(1);
    expect(isLink(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("X");
  });

  it("skips a target already linked to the canonical (idempotent)", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "X");
    const target = join(dir, "AGENTS.md");
    converge1(canonical, target);
    const again = converge1(canonical, target);
    expect(again.linked).toBe(0);
    expect(again.skipped).toBe(1);
  });
});

describe("unlinkContext", () => {
  it("removes a managed link and restores the backed-up original", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "SRC");
    const target = join(dir, "AGENTS.md");
    writeFileSync(target, "ORIG");
    converge1(canonical, target);
    const u = unlinkContext(target, manifest);
    expect(u.removed).toBe(true);
    expect(u.restored).toBe(true);
    expect(isLink(target)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("ORIG");
  });

  it("refuses to touch a symlink it did not create (safety)", () => {
    const canonical = join(dir, "CLAUDE.md");
    writeFileSync(canonical, "SRC");
    const userLink = join(dir, "AGENTS.md");
    symlinkSync(canonical, userLink); // the user's own link — never recorded in our manifest
    const u = unlinkContext(userLink, manifest);
    expect(u.removed).toBe(false);
    expect(u.error).toBe("not-managed");
    expect(isLink(userLink)).toBe(true); // left strictly alone
  });
});
