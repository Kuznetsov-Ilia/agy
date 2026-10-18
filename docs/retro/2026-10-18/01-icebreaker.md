# Retro 2026-10-18: Icebreaker (agy & agy-mcp)

## Executive Summary & Canonical Inventory
- **Canonical agy-mcp copy analysis**:
  - `/Users/ilia/src/agy/agy-mcp` (worktree: `/Users/ilia/src/agy/.worktrees/retro-2026-10-18/agy-mcp`, mtime: `2026-09-06 23:16:57`, commit `2437541` at `2026-10-18 15:15:42`) — Git-canonical source repository (`Kuznetsov-Ilia/agy`, v0.1.0), containing Herdr plugin definitions and legacy pool code `(file:agy-mcp/package.json#L3)`.
  - `/Users/Shared/exo/agy-mcp` (mtime: `2026-09-07 14:10:26`, README mtime: `2026-10-11 20:34:28`) — Live runtime SSOT (v0.2.0, owned by `exo:exo`), branched out to implement Bun UDS daemon (`uds-pool/`) shared across `exo`, `pyypl`, `movementum.lu`, but never committed back to git `(file:/Users/Shared/exo/agy-mcp/package.json#L3)`.
  - `/Users/ilia/.config/cursor/_archive/agy-mcp` (mtime: `2026-10-11 20:34:28`) — Archived copy of installed Cursor plugin referencing `/Users/Shared/exo/agy-mcp/bin/run-server.sh` `(file:/Users/ilia/.config/cursor/_archive/agy-mcp/mcp.json#L5)`.
  - `/Users/ilia/.config/_archive/agy-mcp` (mtime: `2026-09-06 12:56:24`) — Earlier archived overlay configuration `(file:/Users/ilia/.config/_archive/agy-mcp/README.md)`.
  - **Verdict**: `/Users/ilia/src/agy/agy-mcp` is the version-controlled repository of record, while `/Users/Shared/exo/agy-mcp` was the operational runtime SSOT.
- **Current usage and retirement status**:
  - `movementum.lu` retired `agy-mcp` on 2026-10-18 in commit `da8b465` `(git-log: movementum.lu 2026-10-18 da8b465 refactor(cursor): remove agy MCP server and delegation rules)`.
  - Global `~/.cursor/mcp.json` contains no `agy` server (only `fritzbox`) `(file:~/.cursor/mcp.json#L2)`.
  - `~/.claude.json` contains no `agy` server `(file:~/.claude.json)`.
  - `~/.cursor/plugins/local/` is empty `(file:~/.cursor/plugins/local/)`.
  - Local workspace `agy-mcp/cursor-plugin/mcp.json` has `mcpServers: {}` as of commit `2437541` `(file:agy-mcp/cursor-plugin/mcp.json#L2)`.
  - **Recommendation: Retire completely**. The async MCP delegation layer added immense friction (120s timeout mismatches, cross-user permission failures) with zero practical throughput gain.

## Decisions made
- Pivot from Herdr PTY lease pool to Bun UDS pool: Abandoned fragile PTY sessions and `/tmp/agy-pool` locks in favor of a Bun Unix domain socket daemon `(file:/Users/Shared/exo/agy-mcp/README.md#L149-L158)`.
- File-based token storage via loopback SSH variables: Set `SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22'` and `SSH_CLIENT='127.0.0.1 22 22'` to force `agy` to store auth tokens in `~/.gemini/antigravity-cli/antigravity-oauth-token`, bypassing unreliable macOS Keychain in daemon subshells `(file:README.md#L16-L18)`.
- Copy-based Cursor plugin installation: Replaced symlinks with recursive directory copies into `~/.cursor/plugins/local/agy-mcp` because Cursor 3.15+ blocked symlinks resolving outside the plugins directory `(file:/Users/Shared/exo/agy-mcp/README.md#L58-L62)`.
- Asymmetric prompt payloads and strict failure modes: Implemented `ON_FAILURE=strict`, 12KB response truncation caps, and `--add-dir` path references to keep Cursor orchestrator context clean `(file:agy-mcp/cursor-plugin/rules/agy-delegate.mdc#L34-L54)`.
- Full decommissioning on 2026-10-18: Retired PTY lease pool in `agy` and stripped all agy MCP references across consumers `(git-log: 2026-10-18 refactor: retire agy PTY lease pool in favor of Superlab UDS daemon)`.

## Dead ends / gotchas paid for
- Asynchronous MCP delegation timeout illusion: Cursor agent delegated tasks (`analyze_files`, `delegate_task`) to `plugin-agy-mcp-agy` but gave up after a 120s MCP timeout (`-32001 Request timed out`). The agent duplicated work manually while agy completed 42–102 steps in the background unread `(transcript: .retro-input/transcripts/0000_agy-summaries.txt, 2026-10-15)`.
- Cross-user macOS socket permission lockouts: Running the UDS daemon as user `exo` under `/Users/Shared/exo/` caused socket `Permission denied` errors when accessed by user `ilia`, breaking pool health checks `(file:/Users/Shared/exo/agy-mcp/README.md#L140-L145)`.
- Herdr PTY lease management instability: Managing terminal PTYs via Go CLI resulted in stale lease locks, dead PTY processes, and desynchronized worker state `(file:internal/pool/pool.go)`.
- Unversioned runtime fork: Significant UDS daemon development occurred directly in `/Users/Shared/exo/agy-mcp` without syncing commits back to GitHub `Kuznetsov-Ilia/agy` `(file:/Users/Shared/exo/agy-mcp/package.json#L3)`.

## Harness efficiency findings
- Repository session statistics (`.retro-input/usage-stats.txt`):
  - Sessions: 0
  - Turns: 0
  - Tool calls: 0
  - Tokens: 0 in / 0 out
- External delegated session footprint (`.retro-input/transcripts/0000_agy-summaries.txt`):
  - 2026-10-15 (Sheptun Prototype Gap Analysis): 102 steps and 66 steps executed in agy.
  - 2026-10-15 (Sheptun Adversarial Code Review): 42 steps executed in agy.
  - 2026-08-23 (Superlab Architecture and Telegram Pivot): 99 steps executed in agy.
- Ranked harness waste:
  1. **Abandoned background cascades (Rank 1)**: Cursor abandoned background tasks after 120s while agy continued running 40–100 turns of compute, wasting full token quotas on unread output `(transcript: .retro-input/transcripts/0000_agy-summaries.txt, 2026-10-15)`.
  2. **Indirection & maintenance churn (Rank 2)**: Maintaining Go control plane, Node MCP wrapper, Bun UDS daemon, and Herdr plugins burned substantial engineering time for zero net adoption `(git-log: 2026-10-18 refactor: retire agy PTY lease pool in favor of Superlab UDS daemon)`.

## Recurring manual steps that should become scripts or skills
- Antigravity OAuth bootstrap: Manually executing the loopback SSH login command to generate the oauth token file `(file:README.md#L17-L18)`.
- Plugin installation & Cursor window restart: Manual cycle of running `install.mjs`, reloading Cursor, and killing old agent threads `(file:/Users/Shared/exo/agy-mcp/README.md#L69-L77)`.
- Cross-user cleanup: Deleting stale UDS sockets, pidfiles, and logs under `/Users/Shared/` and `/tmp/agy-pool*` `(file:internal/pool/lock.go)`.

## Conventions observed
- Dummy SSH loopback environment variables (`SSH_CONNECTION`, `SSH_CLIENT`) to enforce headless file token generation `(file:agy-mcp/bin/run-server.sh#L5)`.
- Explicit fail-fast error handling (`ON_FAILURE=strict`) rather than silent failure fallback `(file:agy-mcp/cursor-plugin/rules/agy-delegate.mdc#L51)`.
- Bounded LLM output (~12KB cap) with strict provenance headers and footers `(file:agy-mcp/cursor-plugin/rules/agy-delegate.mdc#L34-L35)`.

## Instructions that are ignored, stale or contradictory
- Stale Herdr pool documentation in root README:
  - Rule text: "Herdr pool control plane: ensure, status, restart, reconcile, watch" `(file:README.md#L5)`.
  - Reality: Commit `2437541` stubbed out all pool actions and declared the PTY pool retired `(git-log: 2026-10-18 refactor: retire agy PTY lease pool in favor of Superlab UDS daemon)`.
- Contradictory Cursor delegation rule:
  - Rule text: "Route mechanical/research/draft work through the agy MCP server (CallMcpTool, server=agy)" `(file:agy-mcp/cursor-plugin/rules/agy-delegate.mdc#L2)`.
  - Reality: `mcp.json` has `mcpServers: {}` and global Cursor config removed `agy`, making the rule impossible to execute `(file:agy-mcp/cursor-plugin/mcp.json#L2)`.
- Phantom Superlab UDS pool instructions:
  - Rule text: "cd /path/to/superlab && bun run agy-pool:ensure" `(file:agy-mcp/cursor-plugin/skills/agy/SKILL.md#L59)`.
  - Reality: `/Users/Shared/exo/superlab` contains only SQLite databases; no runnable UDS pool exists there `(file:/Users/Shared/exo/superlab)`.

## Open threads / TODOs
- Remove dead Go pool stubs and CLI code in `cmd/agy-pool` and `internal/pool` `(file:cmd/agy-pool/main.go)`.
- Delete or archive uncommitted `/Users/Shared/exo/agy-mcp` directory `(file:/Users/Shared/exo/agy-mcp)`.
- Update repository README to reflect final archived/retired status `(file:README.md)`.
- Clean up obsolete rule and skill definitions in `agy-mcp/cursor-plugin` `(file:agy-mcp/cursor-plugin/rules/agy-delegate.mdc)`.

## Proposed harness patch list
- `AGENTS.md` — Add project overview defining repository status, retired architecture, and read-only guidance.
- `CLAUDE.md` — Add single-line pointer `@AGENTS.md`.
- `README.md` — Mark repository as retired/archived and document the deprecation of `agy.delegate`.
- `agy-mcp/cursor-plugin/rules/agy-delegate.mdc` — Set `alwaysApply: false` and prepend deprecation notice.
- `agy-mcp/cursor-plugin/skills/agy/SKILL.md` — Add retirement warning to prevent agents attempting agy MCP calls.

## Questions for the human
- Should `/Users/Shared/exo/agy-mcp` be permanently deleted from `/Users/Shared/exo/` to reclaim disk space?
- Should `Kuznetsov-Ilia/agy` repository on GitHub be archived (read-only)?
- Are there any other CLI workflows still relying on the SSH loopback token trick (`SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22'`), or can that documentation be removed entirely?
