# Retro 2026-10-18: Arbiter

Spot-checked against the workspace: `internal/pool` exists, `cmd/agy-pool` retained, README still describes the live pool, and `git log` shows only `2437541` and `ce4285d`. The exo-copy facts are taken from the challenger's checks (not re-run here).

## Decisions

| item | source | decision | why | file |
|---|---|---|---|---|
| Canonical copy = git `agy-mcp`; exo copy = uncommitted v0.2.0 runtime fork; 4 copies listed | 01+02 (rows 1-2) | APPLIED | Verified by challenger | docs/HISTORY-DIGEST.md, AGENTS.md |
| Retire agy-mcp | 01+02 (row 3) | APPLIED | No live consumer | docs/HISTORY-DIGEST.md |
| Create HISTORY-DIGEST | 02 | APPLIED | Required deliverable | docs/HISTORY-DIGEST.md |
| AGENTS.md with status banner, layout, known-stale files | 01+02 | APPLIED | Keeps future agents from trusting stale docs | AGENTS.md |
| CLAUDE.md pointer | 01 | APPLIED | One-line pointer | CLAUDE.md |
| Async timeout claim | 01 vs 02 row 9/15 | APPLIED (reworded) | Marked as corroborated elsewhere, not local | AGENTS.md, digest |
| Delete only `internal/pool/*.go`, keep `cmd/agy-pool` | 02 row 22 | DEFERRED | Product code, outside allow-list; recorded as TODO | AGENTS.md, digest |
| Edit README / agy-delegate.mdc / SKILL.md | 01 | REJECTED | Product code, outside allow-list; listed as known-stale instead | AGENTS.md |
| Delete exo copy | 01 | DEFERRED | Owned by another user; archive first | digest |
| Archive GitHub repo / fix description | 01+02 | DEFERRED | Not file-based | digest |
| Add `.cursor/rules` or skills | — | REJECTED | Tool is retired; rules would add stale always-on context | — |

## Questions for the human
- Archive `/Users/Shared/exo/agy-mcp` to a versioned location before deleting? Not asked → raised now.
- Archive `Kuznetsov-Ilia/agy` on GitHub and fix its description? Not asked → raised now.
- Who applies the product-code fixes (README, `agy-delegate.mdc`, `SKILL.md`, dead `internal/pool/*.go`)? Not asked → raised now.
- Remove the stale `~/.cache/pyypl-migrate/tree/.cursor/mcp.json` agy entry? Not asked → raised now.
- Are Go/TS tests green after `2437541`? Not verified in this retro → raised now.
