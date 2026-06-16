import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoot, readAllRecords } from "../src/util";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "asum-util-"))); // realpath: macOS /var → /private/var
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readAllRecords", () => {
  it("parses JSONL and skips blank + malformed lines", () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\n\n{ not json }\n{"a":2}\n');
    expect(readAllRecords(f)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("gitRoot", () => {
  it("returns the nearest ancestor containing .git", () => {
    mkdirSync(join(dir, ".git"));
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    expect(gitRoot(sub)).toBe(dir);
  });

  it("falls back to the cwd itself when there is no .git", () => {
    const sub = join(dir, "x");
    mkdirSync(sub);
    expect(gitRoot(sub)).toBe(sub);
  });
});
