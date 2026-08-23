# agy-mcp

Thin stdio MCP server wrapping the `agy` (Antigravity) CLI with **typed tools**,
model failover, child kill on 429, file-auth env, spawn mutex, ~12KB truncate +
provenance footer, and `ON_FAILURE=strict`.

MCP server id: **`agy`**.

## Why not community packages?

Bridges like `@trishchuk/antigravity-mcp-server`, `agyforclaude`, and `agy-mcp-server`
usually expose one generic `agy` tool (or heavy worktree/bg suites). This package keeps
the invariants that make Cursor orchestration reliable:

- typed cheap→expensive shapes (`analyze_files` / `deep_search` / `delegate`)
- model failover + child kill on 429 + file-auth env / spawn mutex
- compact output + ~12KB truncate + provenance footer
- `ON_FAILURE=strict` (do not silently absorb inline)
- `agy_doctor` / `agy_quota` (agy-hud cache)

Use a community single-tool bridge if that is all you need; use this when you want
delegation routing that agents can follow consistently.

## Prerequisite — authenticate `agy` (file token)

Background MCP spawns often cannot use macOS Keychain reliably
([antigravity-cli#85](https://github.com/google-antigravity/antigravity-cli/issues/85)).
Canonical auth for this wrapper is the oauth **token file**:

`~/.gemini/antigravity-cli/antigravity-oauth-token`

Bootstrap once with SSH env so `agy` writes the file (not Keychain-only):

```bash
SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22' SSH_CLIENT='127.0.0.1 22 22' agy
test -f ~/.gemini/antigravity-cli/antigravity-oauth-token
agy models
```

`run-agy` / `run-server.sh` / mcp.json always set the same `SSH_*` so children prefer
file storage. Keychain remains best-effort with file fallback. MCP is a typed façade
over the same CLI path (`node dist/cli.js` is the transport fallback).

LLM tools fail until auth works. `agy_doctor` / `agy_quota` need no LLM quota.

## Install (global Cursor)

```bash
cd /path/to/agy-mcp
pnpm install
pnpm build
node bin/install.mjs
# or: pnpm install:cursor
```

`install.mjs` will:

1. build `dist/server.js`
2. **copy** `cursor-plugin/` → `~/.cursor/plugins/local/agy-mcp` (real directory, not a symlink — Cursor 3.15+ rejects local plugins whose target is outside `~/.cursor/plugins/local`)
3. rewrite the installed `mcp.json` to an absolute `bin/run-server.sh` plus the same `SSH_*` env as user `mcp.json`
4. merge `agy` into `~/.cursor/mcp.json` (CLI/Agent belt-and-suspenders)

Then:

1. **Developer: Reload Window**
2. Open a **new** Agent chat (stale sessions miss plugin rules and often stdio)
3. Smoke: `CallMcpTool` `server=agy` `agy_doctor`

After editing plugin rules or skills, re-run `node bin/install.mjs` (the install is a copy, not a live symlink), then Reload Window and open a **new** Agent chat.

### Manual `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "agy": {
      "command": "bash",
      "args": ["/path/to/agy-mcp/bin/run-server.sh"],
      "timeout": 600000,
      "env": {
        "SSH_CONNECTION": "127.0.0.1 22 127.0.0.1 22",
        "SSH_CLIENT": "127.0.0.1 22 22",
        "AGY_PRINT_TIMEOUT": "300s",
        "AGY_TIMEOUT_MS": "360000"
      }
    }
  }
}
```

## Tools

| Tool | Model chain | LLM? |
|---|---|---|
| `analyze_files` | Flash High → Pro Low | yes |
| `deep_search` | Flash Medium → Flash High | yes |
| `adversarial_review` | Pro High → Sonnet Thinking | yes |
| `follow_up` | inherits session | yes |
| `delegate` | Flash High | yes |
| `agy_doctor` | — | no |
| `agy_quota` | — | no |

`sdlc_draft` and product Linear buses are **not** in this package — keep those in the
consuming project overlay.

## Env

| Var | Default | Notes |
|---|---|---|
| `AGY_MCP_WORKSPACE_ROOT` | `cwd` | `--add-dir` default |
| `AGY_MCP_REFUSE_EXTRA` | — | comma/newline list of extra refuse regexes |
| `AGY_BIN` | `agy` | binary override |
| `AGY_MAX_BYTES` | `12288` | truncate cap |
| `AGY_PRINT_TIMEOUT` | `300s` | passed to CLI `--print-timeout` |
| `AGY_TIMEOUT_MS` | `360000` | hard child kill; must be > print timeout |
| `AGY_COOLDOWN_MS` | `60000` | per-model cooldown after 429 |
| `AGY_AUTH_RETRIES` | `3` | same-model retries on auth/LoadToken failures (not print-timeout) |
| `AGY_SKIP_PERMISSIONS` | `1` | pass `--dangerously-skip-permissions` (print mode cannot confirm tools; needed for git archaeology). Set `0`/`false` to disable |
| `AGY_TRANSPORT` | `auto` | `auto` tries Herdr warm pool then print; `print` / `herdr` force one path |
| `AGY_POOL_SIZE` | `5` | workers `agy1`…`agyN` in Herdr workspace `agy-pool` |
| `AGY_POOL_LEASE_MS` | `3000` | how long `auto` waits for an idle worker before print fallback |
| `SSH_CONNECTION` / `SSH_CLIENT` | dummy loopback | force agy file-based token storage |

## Herdr warm pool

Optional parallel transport. Cursor still calls the same MCP tools; `runAgy` leases an idle
`agyN` pane, prompts with a file-result contract, reads `/tmp/agy-pool/<lease>.md`, then
releases with `/clear` so the next job does not inherit the previous conversation.

```bash
herdr integration install antigravity-cli   # once
cd /path/to/agy-mcp && pnpm build
./bin/agy-pool ensure                       # from Herdr plugin root; or: node dist/pool-cli.js ensure
./bin/agy-pool status
```

Workers start with `--dangerously-skip-permissions`. Pool path skips the print spawn mutex.
`follow_up` stays on print/`--conversation` for now.

## Safety (generic)

Hard-refuse defaults:

- private keys / PEM blocks
- prod deploy / destroy / wipe style prompts
- `rm -rf`

Plus secret redaction and home-path collapsing on all returned text.

Projects re-add product refuses without forking:

```bash
export AGY_MCP_REFUSE_EXTRA='\bPHI\b,src/server/auth,wrangler\s+deploy,db:migrate-remote'
```

## Debug CLI

```bash
node dist/cli.js agy_doctor
node dist/cli.js analyze_files '{"prompt":"summarize README.md"}'
```

Exit `0` = ok; `3` = failed / `ON_FAILURE=strict`.

## Build / test

```bash
pnpm install
pnpm build
pnpm test
```

## Layout

```text
agy-mcp/
├── package.json
├── src/
├── cursor-plugin/          # ~/.cursor/plugins/local/agy-mcp
│   ├── .cursor-plugin/plugin.json
│   ├── mcp.json            # server id: agy
│   ├── rules/agy-delegate.mdc
│   └── skills/agy/SKILL.md
├── bin/install.mjs
├── bin/run-server.sh
└── README.md
```

## Out of scope (day one)

- npm / Cursor Marketplace publish (local plugin + absolute path is enough)
- Fixing interactive `agy` auth for you
- Product SDLC / Linear pipelines
