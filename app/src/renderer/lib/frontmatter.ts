// SKILL.md / instruction-file YAML frontmatter parsing (used by the Skills detail view).

/** Split a SKILL.md into its raw YAML frontmatter and the markdown body. */
export function splitSkillMd(md: string): { frontmatter: string; body: string } {
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end >= 0) return { frontmatter: md.slice(3, end).trim(), body: md.slice(end + 4).replace(/^\s*\n/, "") };
  }
  return { frontmatter: "", body: md };
}

/** Parse YAML frontmatter into ordered key/value pairs (handles inline + folded `>-`/`|` scalars). */
export function parseFm(fm: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    let val = (m[2] ?? "").trim();
    if (val === "" || val === ">" || val === ">-" || val === "|" || val === "|-") {
      const buf: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? "";
        if (/^\s+\S/.test(l)) {
          buf.push(l.trim().replace(/^-\s*/, ""));
          i = j;
        } else if (l.trim() === "") {
          i = j;
        } else break;
      }
      if (buf.length) val = buf.join(", ");
    }
    out.push({ key: m[1] ?? "", value: val.replace(/^["']|["']$/g, "") });
  }
  return out;
}
