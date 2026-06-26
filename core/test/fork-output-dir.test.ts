import { describe, expect, it } from "vitest";
import { forkOutputDir } from "../src/fork";
import { encodeOmpDir } from "../src/providers/oh-my-pi";

describe("encodeOmpDir", () => {
  it("home-relative cwd → -a-b-c", () => {
    expect(encodeOmpDir("/Users/me", "/Users/me/ws/proj")).toBe("-ws-proj");
  });
  it("the home dir itself → bare -", () => {
    expect(encodeOmpDir("/Users/me", "/Users/me")).toBe("-");
  });
  it("a cwd outside home → legacy --abs-- form", () => {
    expect(encodeOmpDir("/Users/me", "/tmp/x")).toBe("--tmp-x--");
  });
});

describe("forkOutputDir", () => {
  const home = "/Users/me";
  const cwd = "/Users/me/ws/proj";
  const day = new Date(2026, 5, 24); // local 2026-06-24

  it("claude-code → the cwd-encoded project dir", () => {
    expect(forkOutputDir("claude-code", home, cwd, day)).toBe("/Users/me/.claude/projects/-Users-me-ws-proj");
  });
  it("codex → the dated sessions dir", () => {
    expect(forkOutputDir("codex", home, cwd, day)).toBe("/Users/me/.codex/sessions/2026/06/24");
  });
  it("omp → sessions dir ending in the encoded cwd", () => {
    expect(forkOutputDir("omp", home, cwd, day)).toMatch(/\/sessions\/-ws-proj$/);
  });
  it("a non-target slug → null", () => {
    expect(forkOutputDir("gemini", home, cwd, day)).toBeNull();
  });
});
