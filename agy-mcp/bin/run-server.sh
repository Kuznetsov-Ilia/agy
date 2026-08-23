#!/usr/bin/env bash
# Stdio MCP entry for Cursor (plugin mcp.json / user ~/.cursor/mcp.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"
export AGY_MCP_WORKSPACE_ROOT="${AGY_MCP_WORKSPACE_ROOT:-$PWD}"

# Force agy file-based oauth token storage (Keychain LoadToken often times out
# for MCP/background spawns — antigravity-cli#85).
export SSH_CONNECTION="${SSH_CONNECTION:-127.0.0.1 22 127.0.0.1 22}"
export SSH_CLIENT="${SSH_CLIENT:-127.0.0.1 22 22}"

if command -v agy >/dev/null 2>&1; then
  export AGY_BIN="${AGY_BIN:-$(command -v agy)}"
fi

cd "$AGY_MCP_WORKSPACE_ROOT"
exec node "$ROOT/dist/server.js"
