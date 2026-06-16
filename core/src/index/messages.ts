import type { CanonicalSession } from "../model";
import type { DB } from "./db";

/** Replace this session's message_entries with its parsed transcript. Returns rows written. */
export function indexSession(db: DB, session: CanonicalSession): number {
  const del = db.prepare("DELETE FROM message_entries WHERE session_path = ?");
  const ins = db.prepare(`
    INSERT INTO message_entries
      (session_path, idx, native_id, role, source_type, content, search_text, timestamp, is_sidechain)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(session.sourcePath);
    let n = 0;
    for (const m of session.messages) {
      const sourceType = m.toolResults.length ? "tool_result" : m.toolCalls.length ? "tool_call" : "text";
      const searchText = m.content || (m.toolCalls[0]?.name ? `[tool: ${m.toolCalls[0].name}]` : "");
      if (!searchText) continue;
      ins.run(
        session.sourcePath,
        m.idx,
        m.nativeId ?? null,
        m.role,
        sourceType,
        m.content,
        searchText,
        m.timestamp ?? null,
        m.isSidechain ? 1 : 0,
      );
      n++;
    }
    return n;
  });
  return tx() as number;
}

/** Rebuild the FTS5 index from message_entries (external-content table). */
export function rebuildFts(db: DB): void {
  db.exec("INSERT INTO message_fts(message_fts) VALUES('rebuild')");
}

/** Where a hit matched: session metadata (stronger) vs. message body. */
export type HitVia = "title" | "project" | "prompt" | "content";

export interface SearchHit {
  session_path: string;
  title: string | null;
  provider_slug: string;
  project_root: string | null;
  snip: string;
  via: HitVia;
}

function makeSnippet(content: string, q: string): string {
  const i = content.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return content.slice(0, 80);
  const start = Math.max(0, i - 24);
  return `${start > 0 ? "…" : ""}${content.slice(start, i)}[${content.slice(i, i + q.length)}]${content.slice(i + q.length, i + q.length + 40)}…`;
}

/** Message-content matches: FTS5 trigram (≥3 codepoints, ranked) or LIKE fallback (1–2, common for CJK). */
function contentHits(db: DB, q: string, limit: number): SearchHit[] {
  if ([...q].length >= 3) {
    return (
      db
        .prepare(`
        SELECT m.session_path, s.title, s.provider_slug, s.project_root,
               snippet(message_fts, 3, '[', ']', '…', 8) AS snip
        FROM message_fts
        JOIN message_entries m ON m.rowid_pk = message_fts.rowid
        JOIN sessions s ON s.session_path = m.session_path
        WHERE message_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
        .all(`"${q.replace(/"/g, '""')}"`, limit) as Omit<SearchHit, "via">[]
    ).map((r) => ({ ...r, via: "content" as const }));
  }
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = db
    .prepare(`
      SELECT m.session_path, s.title, s.provider_slug, s.project_root, m.content
      FROM message_entries m
      JOIN sessions s ON s.session_path = m.session_path
      WHERE m.content LIKE ? ESCAPE '\\'
      LIMIT ?
    `)
    .all(like, limit) as Array<{ session_path: string; title: string | null; provider_slug: string; project_root: string | null; content: string }>;
  return rows.map(({ content, ...r }) => ({ ...r, snip: makeSnippet(content, q), via: "content" }));
}

/**
 * Search sessions by metadata (title / project / first prompt) AND message content.
 * Metadata matches come first — a session whose project or title matches the query is a stronger
 * signal than one message that happens to mention it — then content matches, deduped by session.
 * Substring/trigram matching gives partial-word + CJK recall without an embedding pipeline.
 */
export function searchMessages(db: DB, query: string, limit = 20): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const ql = q.toLowerCase();
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const out: SearchHit[] = [];
  const seen = new Set<string>();

  // 1. Session metadata (title / project_root / last_prompt). Workspace is deliberately excluded —
  //    full cwd paths share too many common substrings and would flood results.
  const meta = db
    .prepare(`
      SELECT session_path, title, provider_slug, project_root, last_prompt
      FROM sessions
      WHERE title LIKE ? ESCAPE '\\' OR project_root LIKE ? ESCAPE '\\' OR last_prompt LIKE ? ESCAPE '\\'
      ORDER BY ended_at DESC
      LIMIT ?
    `)
    .all(like, like, like, limit) as Array<{
    session_path: string;
    title: string | null;
    provider_slug: string;
    project_root: string | null;
    last_prompt: string | null;
  }>;
  for (const r of meta) {
    if (seen.has(r.session_path)) continue;
    let via: HitVia;
    let snip: string;
    if (r.title?.toLowerCase().includes(ql)) {
      via = "title";
      snip = r.title;
    } else if (r.project_root?.toLowerCase().includes(ql)) {
      via = "project";
      snip = r.project_root;
    } else {
      via = "prompt";
      snip = makeSnippet(r.last_prompt ?? "", q);
    }
    seen.add(r.session_path);
    out.push({ session_path: r.session_path, title: r.title, provider_slug: r.provider_slug, project_root: r.project_root, snip, via });
  }

  // 2. Message-content matches (dedup against metadata hits).
  for (const h of contentHits(db, q, limit)) {
    if (seen.has(h.session_path)) continue;
    seen.add(h.session_path);
    out.push(h);
  }
  return out.slice(0, limit);
}
