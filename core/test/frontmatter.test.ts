import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/skills/scan";

describe("parseFrontmatter", () => {
  it("parses inline name/description", () => {
    expect(parseFrontmatter("---\nname: foo\ndescription: bar baz\n---\n# body")).toEqual({
      name: "foo",
      description: "bar baz",
    });
  });

  it("joins a folded scalar (>-) into one line", () => {
    const md = "---\nname: foo\ndescription: >-\n  line one\n  line two\n---\n";
    expect(parseFrontmatter(md).description).toBe("line one line two");
  });

  it("strips surrounding quotes", () => {
    expect(parseFrontmatter('---\nname: "quoted name"\n---').name).toBe("quoted name");
  });

  it("returns {} when there is no frontmatter", () => {
    expect(parseFrontmatter("just a body, no fences")).toEqual({});
  });

  it("returns {} on an unterminated frontmatter block", () => {
    expect(parseFrontmatter("---\nname: foo\nno closing fence")).toEqual({});
  });
});
