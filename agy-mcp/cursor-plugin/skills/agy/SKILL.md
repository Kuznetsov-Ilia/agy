---
description: Route mechanical/research/draft work through the agy MCP server (CallMcpTool, server=agy). Load BEFORE bulk Read/Grep, plan execution, log/diff summaries, or scoped review. Drafts only — you verify. Never for secrets, prod deploy/destroy, or project refuse-list work.
globs: []
---

# agy — MCP delegation

Thin stdio MCP (`server: "agy"`). In Superlab the server is the UDS worker
pool (`src/agy-pool`), not `agy-mcp` PTY lease / `/tmp/agy-pool`.

Auth is **file-based** (`~/.gemini/antigravity-cli/antigravity-oauth-token`).
Bootstrap if token missing:

```bash
SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22' SSH_CLIENT='127.0.0.1 22 22' agy
test -f ~/.gemini/antigravity-cli/antigravity-oauth-token
agy models
```

## Mandatory order

```
GetMcpTools({ server: "agy" })
CallMcpTool({ server: "agy", toolName: "agy_doctor", arguments: {} })
CallMcpTool({ server: "agy", toolName: "analyze_files" | "deep_search" | …, arguments: { … } })
```

## Tools

| Tool | Shape |
|---|---|
| `analyze_files` | multi-file / logs / dumps |
| `deep_search` | repo grep / git archaeology |
| `delegate` | other heavy text (draft only; `raw` optional) |
| `adversarial_review` | plan/code critique |
| `follow_up` | resume by `session_id` + `model` |
| `agy_doctor` / `agy_quota` | health + quota HUD cache |

## Env

| Var | Role |
|---|---|
| `AGY_MCP_WORKSPACE_ROOT` | default `--add-dir` |
| `AGY_MCP_REFUSE_EXTRA` | extra refuse regexes (comma/newline) |
| `AGY_BIN` | override agy binary path |
| `AGY_MAX_BYTES` | truncate cap (default 12288) |
| `AGY_SKIP_PERMISSIONS` | default on — `--dangerously-skip-permissions` (print mode); set `0` to disable |
| `SSH_CONNECTION` / `SSH_CLIENT` | force file token storage (set by install / run-server) |

## Transport

Superlab UDS pool. Watch Herdr panes `agy1`/`agy2` (live prompt + print stream)
or `bun run agy-pool:watch 1`. Footer `transport:uds-pool`. Do not use
`AGY_TRANSPORT=herdr`.

If `CallMcpTool` returns **`Not connected`**:

```
cd /path/to/superlab && bun run agy-pool:ensure
bun run agy-pool:status
```

Prefer a **new Agent chat** after Reload Window.

## `ON_FAILURE=strict`

Refused prompt / quota exhausted / unauthenticated → stop, surface the error, ask
how to proceed. Do not silently grind the work inline.
