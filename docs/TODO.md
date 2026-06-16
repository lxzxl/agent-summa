# TODO

## Done (2026-06-16)

1. ✅ **Collapsible project groups** — when grouped by project, the group header (`grp-head`) is clickable to collapse/expand (▸/▾); collapsing hides that group's rows so the list doesn't get overwhelming.

2. ✅ **Search enhancement** — beyond message content, search now also matches a session's **title / project name / first prompt** (metadata hits rank before content hits, deduped per session); each hit carries a `via` tag (title/project/prompt/message), and clicking a hit opens that session directly.
   - "Fuzzy" = trigram (≥3 chars, incl. CJK substrings) + LIKE (1–2 chars) substring matching — no embeddings needed.
   - Verified: `web-api` → 8 project hits; `acme-web` → title/project/content mix; a project name → finds that project's sessions even when the messages never mention the name.

3. ✅ **Group-view polish**
   - One-click expand/collapse all: a `⊟ Collapse all / ⊞ Expand all` toggle in the list header (switches by current state).
   - Group header visually distinct from session cards: dark inset band + bold titlefont project name + count pill; session cards indented under the header + a left guide line, so the hierarchy reads clearly.

4. ✅ **Group names preserved in search results** — when searching in project-grouped mode, hits are shown grouped by project (header + count) instead of degrading to a flat list; collapse / expand-all apply to search results too. Verified: a common term → 11 project groups, 41 hits.

5. ✅ **Reveal the selected session in the list** — after selecting a session (especially from a search hit, which clears the query and re-renders the list from the top), automatically: ① expand its group if collapsed, ② scroll its row into view (`scrollIntoView`), ③ highlight it (`.row.sel`, already present). Added `data-path` to `Row` and a new effect watching `selected`. Verified: collapse all → search → click a hit → that session's group expands, scrolls into view, and is highlighted, with the query cleared.

## Decision: sqlite-vec (semantic/vector search) — **deferred**

Conclusion: **do not introduce sqlite-vec for now.**

Reasons:
- **The embedding pipeline is heavy**: vectorizing ~89k messages needs either a local model (~100MB+, slow first-time embedding) or an API (costs money + sends conversation content out, violating local-first).
- **Storage + native dependency**: 89k × N-dim floats ≈ hundreds of MB; plus the `sqlite-vec` native extension (a `.dylib`, per-platform builds + another native dependency), which conflicts with the "only better-sqlite3 as a native module" stance.
- **Already sufficient**: trigram FTS + metadata search already cover "find a session by keyword / project name / title."
- Semantic search (recall by concept without a keyword) is a power feature, not a current need.

Re-evaluation trigger: if keyword + metadata search proves clearly insufficient and users routinely can't recall the exact wording — then prefer a **local small model (transformers.js/onnx) for offline embedding + sqlite-vec**, still local-first.
