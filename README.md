# agy — Herdr plugin + Cursor MCP pool

Portable warm pool for Antigravity (`agy`) delegation from Cursor.

- **Go** (`bin/agy-pool`) — Herdr pool control plane: ensure, status, restart, reconcile, watch
- **Node** (`agy-mcp/`) — Cursor stdio MCP server (typed tools, herdr-pool transport, lease protocol)

Herdr plugin id: **`agy.delegate`**.

## New machine bootstrap

```bash
# 0) tools
brew install agy herdr go node pnpm git

# 1) Antigravity file-auth (once, interactive)
SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22' SSH_CLIENT='127.0.0.1 22 22' agy
test -f ~/.gemini/antigravity-cli/antigravity-oauth-token

# 2) Herdr + integration
herdr   # start session / server
herdr integration install antigravity-cli

# 3) Plugin (builds Go + agy-mcp; public repo — no GitHub auth required)
herdr plugin install Kuznetsov-Ilia/agy --yes
herdr plugin action invoke agy.delegate.cursor-install

# 4) Cursor: reload → new Agent chat
# MCP smoke: agy_doctor, then one heavy call

# 5) Verify pool
herdr plugin action invoke agy.delegate.status
# expect workspace agy-pool, workers agy1…agy5 with idle/working (not unknown)
```

Optional config: `herdr plugin config-dir agy.delegate` → `config.json` with `pool_size`, `default_cwd`.

Local development on an existing machine: `herdr plugin link /path/to/agy` instead of GitHub install.

## Local development

```bash
go build -o bin/agy-pool ./cmd/agy-pool
herdr plugin link "$(pwd)"
./bin/agy-pool ensure --cwd /path/to/project
./bin/agy-pool status
```

## Actions

| Action | Command |
|---|---|
| Ensure pool | `herdr plugin action invoke agy.delegate.ensure` |
| Status | `herdr plugin action invoke agy.delegate.status` |
| Reconcile | `herdr plugin action invoke agy.delegate.reconcile` |
| Cursor MCP | `herdr plugin action invoke agy.delegate.cursor-install` |

## Layout

```text
agy/                 # Herdr plugin root
  herdr-plugin.toml
  cmd/agy-pool/      # Go CLI
  internal/pool/     # pool control plane
  agy-mcp/           # Cursor MCP (Node)
```

Pool workspace label: `agy-pool`. Workers: `agy1`…`agyN` (default 5).
