import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeOmpFork } from "../src/fork";
import { OhMyPiProvider } from "../src/providers/oh-my-pi";

let dir: string;
let file: string;
const provider = new OhMyPiProvider();

// A realistic omp session: header + model_change + thinking_level_change, then two human turns
// around one assistant turn that thinks, replies, and calls a tool whose output lands in a
// separate `toolResult` message (omp's real on-disk shape).
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "asum-omp-"))); // realpath: macOS /var → /private/var
  file = join(dir, "2026-06-22T02-52-01-257Z_019eed3d-f569-7000-bb77-4572c4719cca.jsonl");
  const entries: unknown[] = [
    { type: "session", version: 3, id: "019eed3d-f569-7000-bb77-4572c4719cca", timestamp: "2026-06-22T02:52:01.257Z", cwd: dir, title: "Check Project", titleSource: "auto" },
    { type: "model_change", id: "8db0fd42", parentId: null, timestamp: "2026-06-22T02:52:01.362Z", model: "anthropic/claude-opus-4-8" },
    { type: "thinking_level_change", id: "bccbefad", parentId: "8db0fd42", timestamp: "2026-06-22T02:52:01.400Z", thinkingLevel: "high" },
    { type: "message", id: "e7e04191", parentId: "bccbefad", timestamp: "2026-06-22T02:54:00.163Z", message: { role: "user", content: [{ type: "text", text: "first prompt" }], attribution: "user" } },
    {
      type: "message",
      id: "4b9f542e",
      parentId: "e7e04191",
      timestamp: "2026-06-22T02:54:05.208Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-opus-4-8",
        content: [
          { type: "thinking", thinking: "internal reasoning that must not leak into content" },
          { type: "text", text: "answer" },
          { type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "omp://" } },
        ],
      },
    },
    { type: "message", id: "cccc3333", parentId: "4b9f542e", timestamp: "2026-06-22T02:54:05.300Z", message: { role: "toolResult", toolCallId: "toolu_1", toolName: "read", content: [{ type: "text", text: "file contents here" }] } },
    { type: "message", id: "aaaa1111", parentId: "cccc3333", timestamp: "2026-06-22T02:55:00.000Z", message: { role: "user", content: [{ type: "text", text: "second prompt" }], attribution: "user" } },
  ];
  writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("OhMyPiProvider.readHead", () => {
  it("derives metadata from the header and message stream", () => {
    const h = provider.readHead(file);
    expect(h.sessionId).toBe("019eed3d-f569-7000-bb77-4572c4719cca");
    expect(h.providerSlug).toBe("omp");
    expect(h.title).toBe("Check Project");
    expect(h.titleSource).toBe("ai"); // header titleSource:"auto" → ai
    expect(h.modelName).toBe("anthropic/claude-opus-4-8");
    expect(h.workspace).toBe(dir);
    expect(h.rounds).toBe(2); // two human text turns; assistant + toolResult are not rounds
    expect(h.messageCount).toBe(4); // 2 user + 1 assistant + 1 toolResult
    expect(h.lastPrompt).toBe("second prompt");
    expect(h.startedAt).toBeLessThanOrEqual(h.endedAt!);
  });

  it("falls back to the first prompt for the title when the header has none", () => {
    const f2 = join(dir, "2026-06-22T03-00-00-000Z_019eeeee-0000-7000-aaaa-000000000000.jsonl");
    writeFileSync(
      f2,
      `${[
        { type: "session", version: 3, id: "019eeeee-0000-7000-aaaa-000000000000", timestamp: "2026-06-22T03:00:00.000Z", cwd: dir },
        { type: "message", id: "11112222", parentId: null, timestamp: "2026-06-22T03:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "untitled work please" }] } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n")}\n`,
    );
    const h = provider.readHead(f2);
    expect(h.title).toBe("untitled work please");
    expect(h.titleSource).toBe("prompt");
  });

  it("builds a provider/modelId model name for legacy ~/.pi sessions", () => {
    const f3 = join(dir, "2026-06-22T04-00-00-000Z_019efff0-0000-7000-bbbb-000000000000.jsonl");
    writeFileSync(
      f3,
      `${[
        { type: "session", version: 3, id: "019efff0-0000-7000-bbbb-000000000000", timestamp: "2026-06-22T04:00:00.000Z", cwd: dir },
        { type: "model_change", id: "4bd2f775", parentId: null, timestamp: "2026-06-22T04:00:00.500Z", provider: "deepseek", modelId: "deepseek-v4-pro" },
        { type: "message", id: "22223333", parentId: "4bd2f775", timestamp: "2026-06-22T04:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n")}\n`,
    );
    expect(provider.readHead(f3).modelName).toBe("deepseek/deepseek-v4-pro");
  });
});

describe("OhMyPiProvider.read", () => {
  it("linearizes messages, drops thinking, and captures tool calls + results", () => {
    const s = provider.read(file);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    expect(s.messages[0].content).toBe("first prompt");
    expect(s.messages[1].content).toBe("answer"); // thinking block excluded from content
    expect(s.messages[1].toolCalls).toEqual([{ id: "toolu_1", name: "read", arguments: { path: "omp://" } }]);
    expect(s.messages[2].content).toBe("file contents here");
    expect(s.messages[2].toolResults).toEqual([{ callId: "toolu_1", content: "file contents here", isError: false }]);
    expect(s.messages[3].content).toBe("second prompt");
    expect(s.messageCount).toBe(4);
  });
});

describe("OhMyPiProvider routing", () => {
  it("resumes via `omp --resume <id>` in the workspace", () => {
    expect(provider.resumeCmd("019eed3d", "", "/work/x")).toEqual({ program: "omp", args: ["--resume", "019eed3d"], cwd: "/work/x" });
  });

  it("owns .jsonl files under its session roots but not other agents'", () => {
    const root = provider.sessionRoots()[0];
    expect(provider.ownsPath(join(root, "-ws-proj", "2026-06-22T02-52-01-257Z_019eed3d.jsonl"))).toBe(true);
    expect(provider.ownsPath(join("/Users/me/.claude/projects/p", "abc.jsonl"))).toBe(false);
  });
});

describe("writeOmpFork", () => {
  it("writes a resumable omp session that round-trips back through the provider", () => {
    const source = provider.read(file);
    const res = writeOmpFork(source, join(dir, "out"));
    expect(res.targetSlug).toBe("omp");
    expect(res.resume).toBe(`omp --resume ${res.sessionId}`);
    expect(res.turns).toBe(5); // fork banner + 4 carried turns

    const forked = provider.read(res.path);
    expect(forked.messages[0].content).toContain("Forked from omp");
    expect(forked.messages).toHaveLength(5);
    expect(forked.messages.some((m) => m.content.includes("first prompt"))).toBe(true);
  });
});
