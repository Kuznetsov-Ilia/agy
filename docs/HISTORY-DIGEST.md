# agy / agy-mcp — history digest (as of 2026-10-18)

## What they are
- **agy**: Go Herdr plugin (`agy.delegate`) that kept a warm pool of Antigravity (`agy`) PTY sessions.
- **agy-mcp**: Node/TS stdio MCP server letting Cursor delegate heavy/mechanical tasks to `agy`
  (typed tools, 12KB output cap, strict failure mode).

## Timeline
- Early Sep 2026: Herdr PTY lease pool (Go) + Node MCP server + Cursor plugin; git copy v0.1.0 (mtime 2026-09-06).
- 2026-09-07 onward: pool reimplemented as a Bun Unix-socket daemon (`uds-pool/`, v0.2.0) shared by several
  projects; developed in `/Users/Shared/exo/agy-mcp`, never committed back. README there updated 2026-10-11.
- ce4285d: plugin made public-ready as `agy.delegate`.
- 2026-10-15: agy sessions of 42–102 steps ran from Cursor while the MCP call had timed out client-side.
- 2026-10-18: commit `2437541` retired the PTY pool (11 files, +71/−556); `movementum.lu` commit `da8b465`
  removed its agy MCP server, delegation rule and skill the same day.

## Key decisions
- PTY pool -> UDS daemon: PTY leases left stale locks and dead workers.
- File-based token via loopback `SSH_CONNECTION`/`SSH_CLIENT` env: macOS Keychain is unreliable in daemon subshells.
- Cursor plugin installed by copy: Cursor 3.15+ blocks symlinks resolving outside the plugins dir.
- `ON_FAILURE=strict`, 12KB cap, paths via `--add-dir`: keep orchestrator context small and failures visible.
- Retire everything on 2026-10-18: no consumer justified the maintenance of four layers.

## agy-mcp copies — which is canonical
| Path | mtime | Role |
|---|---|---|
| `/Users/ilia/src/agy/agy-mcp` | 2026-09-06 23:16 | **Canonical** (only git-tracked, v0.1.0) |
| `/Users/Shared/exo/agy-mcp` | 2026-09-07 14:10 (README 2026-10-11) | Runtime fork v0.2.0, uncommitted, owner `exo`; only copy of UDS code |
| `~/.config/cursor/_archive/agy-mcp` | 2026-10-11 20:34 | Archive of installed plugin |
| `~/.config/_archive/agy-mcp` | 2026-09-06 12:56 | Older archive |

## Is agy-mcp still used? Keep or retire?
No. `~/.cursor/mcp.json` and `~/.claude.json` have no agy server, `~/.cursor/plugins/local/` is empty,
`cursor-plugin/mcp.json` is `{}`, `movementum.lu` removed it. Only a stale cache file
(`~/.cache/pyypl-migrate/tree/.cursor/mcp.json`) still mentions it; it is not live.
**Recommendation: retire.** Archive `/Users/Shared/exo/agy-mcp` (tarball) before any deletion.

## Gotchas paid for
- Cursor MCP timeout (~120s, `-32001`) vs long agy runs: agent gave up and redid the work (details corroborated by
  a sibling project's transcript, not by this repo's inputs; step counts verified locally).
- Cross-user (`exo` vs `ilia`) socket `Permission denied`.
- Unversioned fork drifted from git (0.1.0 vs 0.2.0).
- The retirement left stale docs: README, `agy-delegate.mdc` (`alwaysApply: true`), `SKILL.md`, GitHub description.

## Harness lessons
- Stale always-on rules pointing at removed tools are worse than none; retire rules together with the tool.
- Retro stages must respect the write allow-list; product-code fixes become human TODOs.
- `usage-stats.txt` was empty (0 sessions), so token/turn waste cannot be quantified; only step counts exist.
- Test status of the retirement commit is unverified.

## Current state
- Works: `cursor-install` action; Go CLI stubs; git `agy-mcp` TS sources.
- Broken/stale: README Actions table, `agy-delegate.mdc`, `SKILL.md`, GitHub description; `internal/pool/*.go` dead code.
- Unfinished: archive/removal of the `exo` copy; GitHub repo not archived.

## Next step
Archive `/Users/Shared/exo/agy-mcp` (ask owner `exo`; tar into a versioned location), then open one normal PR that
rewrites README as "retired", sets `agy-delegate.mdc` `alwaysApply: false` (or deletes it), fixes `SKILL.md`, and
deletes `internal/pool/{pool.go,lock.go}`.
- Follow-up: archive the GitHub repo and update its description.
- Follow-up: delete the stale `~/.cache/pyypl-migrate` agy entry.
