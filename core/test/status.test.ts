import { describe, expect, it, vi } from "vitest";
import { type FsProbe, sessionStatus, type StatusInput } from "../src/index/status";

const HOUR = 3_600_000;
const NOW = 1_000_000_000_000;

const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  source: "cli",
  endedAt: NOW - HOUR - 1, // ended long ago by default → status decided by interrupted/rounds/workspace
  rounds: 5,
  workspace: "/ws/proj",
  sourcePath: "/p/s.jsonl",
  interrupted: false,
  ...over,
});
const probe = (over: Partial<FsProbe> = {}): FsProbe => ({ exists: () => true, mtimeMs: () => null, ...over });

describe("sessionStatus", () => {
  it("vm source short-circuits to null, ignoring everything else", () => {
    const s = input({ source: "vm", rounds: 0, workspace: "/gone", interrupted: true, endedAt: NOW - 1000 });
    expect(sessionStatus(s, NOW, probe({ exists: () => false, mtimeMs: () => NOW }))).toBeNull();
  });

  it("active when ended <1h ago and the file changed <60s ago", () => {
    const s = input({ endedAt: NOW - 1000 });
    expect(sessionStatus(s, NOW, probe({ mtimeMs: () => NOW - 1000 }))).toBe("active");
  });

  it("not active when the file mtime is stale, even if it ended recently", () => {
    const s = input({ endedAt: NOW - 1000 });
    expect(sessionStatus(s, NOW, probe({ mtimeMs: () => NOW - 120_000 }))).toBeNull();
  });

  it("does NOT stat sessions that ended over an hour ago (the optimization)", () => {
    const mtimeMs = vi.fn(() => NOW);
    sessionStatus(input({ endedAt: NOW - HOUR - 1 }), NOW, probe({ mtimeMs }));
    expect(mtimeMs).not.toHaveBeenCalled();
  });

  it("active wins over interrupted", () => {
    const s = input({ endedAt: NOW - 1000, interrupted: true });
    expect(sessionStatus(s, NOW, probe({ mtimeMs: () => NOW }))).toBe("active");
  });

  it("interrupted wins over empty and orphaned", () => {
    const s = input({ interrupted: true, rounds: 0, workspace: "/gone" });
    expect(sessionStatus(s, NOW, probe({ exists: () => false }))).toBe("interrupted");
  });

  it("empty when rounds=0 and not interrupted", () => {
    expect(sessionStatus(input({ rounds: 0 }), NOW, probe())).toBe("empty");
  });

  it("orphaned when the workspace dir is gone", () => {
    expect(sessionStatus(input({ workspace: "/gone" }), NOW, probe({ exists: () => false }))).toBe("orphaned");
  });

  it("null (normal) when workspace exists, rounds>0, not interrupted, not recently active", () => {
    expect(sessionStatus(input(), NOW, probe({ exists: () => true }))).toBeNull();
  });

  it("no workspace → never orphaned", () => {
    expect(sessionStatus(input({ workspace: null }), NOW, probe({ exists: () => false }))).toBeNull();
  });
});
