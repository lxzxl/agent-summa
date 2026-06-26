# CONTEXT.md

The domain language (ubiquitous language) for agent-summa. Engineering skills read this before exploring the codebase; name concepts the way this file does. Terms are added as they get resolved — this is not an exhaustive glossary.

## Session status

A **session status** is a derived, display-time signal about a session — not a stored field. Exactly one applies (or none), in priority order:

- **active** — a live run: the session ended within the last hour _and_ its backing file changed in the last minute.
- **interrupted** — the session ended on a user abort (Ctrl-C), with no later turn.
- **empty** — zero conversation rounds (a shell with only injected context, no real prompt).
- **orphaned** — the session's workspace directory no longer exists on disk.
- _(none)_ — a normal, complete session.

Derived by `sessionStatus` in `core/src/index/status.ts` from a narrow `StatusInput` plus an injected `FsProbe` (so it's testable without a database or Electron). `vm`-sourced sessions short-circuit to _none_ — they carry their own lock signal.
