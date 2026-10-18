# agy — agent rules

## Status (read first)
The agy PTY lease pool and the agy MCP delegation layer are **retired** (commit `2437541`, 2026-10-18).
`movementum.lu` removed its agy MCP server and delegation rules the same day. No live MCP consumer is
known. Do not re-enable `agy.delegate` delegation or re-add an `agy` MCP server without reading
`docs/HISTORY-DIGEST.md` first.

## Purpose
Personal tool repo (GitHub `Kuznetsov-Ilia/agy`): a Herdr plugin (`agy.delegate`) plus a Cursor MCP server
that delegated heavy/mechanical work from Cursor to Antigravity (`agy`). History: `docs/HISTORY-DIGEST.md`.

## Layout
- `cmd/agy-pool/main.go` — Go CLI. Only live action: `cursor-install`. `ensure/status/restart/reconcile/watch`
  are intentional retirement stubs (exit 2). Do not delete the whole `cmd/agy-pool`.
- `internal/cursorinstall`, `internal/config`, `internal/herdr` — live helpers.
- `internal/pool/{pool.go,lock.go}` — dead code (zero importers). Candidate for deletion by the owner.
- `agy-mcp/` — Node/TS stdio MCP server (git copy, v0.1.0), `cursor-plugin/` (rules, skill, `mcp.json` = `{}`).
- `herdr-plugin.toml` — manifest; only the `cursor-install` action remains.
- `docs/retro/2026-10-18/` — retro reports (01 icebreaker, 02 challenger, 03 arbiter).

## agy-mcp copies (canonical answer)
- **Canonical: `agy-mcp/` in this git repo** (only versioned copy, v0.1.0).
- `/Users/Shared/exo/agy-mcp` — v0.2.0 runtime fork with `uds-pool/`, never committed, owned by macOS user `exo`
  (read-only for us). The only copy of the UDS daemon code; archive before anyone deletes it.
- `~/.config/cursor/_archive/agy-mcp`, `~/.config/_archive/agy-mcp` — archives, not live.
- Recommendation: retire (no consumers). Do not edit the `exo` copy.

## Run / test
- Go: `go build ./... && go test ./...` (module in `go.mod`).
- MCP: `cd agy-mcp && pnpm install && pnpm test` (vitest). No CI config exists; the 2437541 retirement was not
  verified by tests in the retro.
- agy auth bootstrap (once): run `agy` with `SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22'` and
  `SSH_CLIENT='127.0.0.1 22 22'` so the token is stored in `~/.gemini/antigravity-cli/antigravity-oauth-token`
  instead of the unreliable macOS Keychain.

## Conventions
- Fail fast (`ON_FAILURE=strict`), bounded output (~12KB cap), provenance footer on delegated results.
- Cursor plugins install by copy, not symlink (Cursor 3.15+ rejects symlinks leaving the plugins dir).
- Never put secrets, OAuth tokens or account emails in repo files or docs.

## Known-stale files (do not trust at face value; fix needs a normal PR)
- `README.md` — still documents the live Herdr pool / Actions table.
- `agy-mcp/cursor-plugin/rules/agy-delegate.mdc` — `alwaysApply: true`, routes to a non-existent MCP server.
- `agy-mcp/cursor-plugin/skills/agy/SKILL.md` — refers to `bun run agy-pool:ensure` in a superlab dir that has no pool.
- GitHub description still says "warm agy pool + Cursor MCP".

## Gotchas
- Cursor MCP calls time out at ~120s (`-32001`) while agy keeps running; the agent then duplicates the work.
  Delegation of long jobs needs poll/resume, not a single blocking call.
- Cross-user sockets/files under `/Users/Shared/exo/` cause `Permission denied` for the other macOS user.
- A runtime fork edited outside git drifts silently (0.1.0 in git vs 0.2.0 live). Commit or don't fork.

## Efficiency rules
- Don't build extra layers (Go + Node + Bun + Herdr) for a single-user tool without a measured throughput win.
- Delegate only when the result will actually be read; set a budget and stop condition before delegating.
- Retro/agent stages: stay inside the allow-list; flag out-of-scope fixes as human TODOs instead of listing them as patches.
- Verify claims against files before recording them; separate locally verified facts from sibling-project evidence.
