# AGENTS.md

Guidance for AI coding agents working in this repository.

## Agent skills

### Issue tracker

Issues and PRDs live as local markdown under `.scratch/<feature-slug>/` (`PRD.md` +
`issues/NN-slug.md`); no external-PR triage. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, names unchanged: `needs-triage` / `needs-info` /
`ready-for-agent` / `ready-for-human` / `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by
`/domain-modeling`). See `docs/agents/domain.md`.
