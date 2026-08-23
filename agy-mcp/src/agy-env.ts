// Non-interactive auth env for the agy (Antigravity) CLI.
//
// Background spawns (MCP → node → agy) often hit macOS Keychain LoadToken
// timeouts (~1s). agy falls back to file storage when it detects an SSH/WSL
// session; we fake that signal so every child prefers
// ~/.gemini/antigravity-cli/antigravity-oauth-token.
import { homedir } from "node:os";
import { join } from "node:path";

/** Dummy SSH_* values that flip agy into file-based token storage. */
export const AGY_SSH_CONNECTION = "127.0.0.1 22 127.0.0.1 22";
export const AGY_SSH_CLIENT = "127.0.0.1 22 22";

/** Canonical oauth token path under $HOME (mode 0600 JSON with refresh_token). */
export function agyOauthTokenPath(home = process.env.HOME ?? homedir()): string {
  if (process.env.AGY_OAUTH_TOKEN_PATH) return process.env.AGY_OAUTH_TOKEN_PATH;
  return join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token");
}

/**
 * Env overlay for every `agy` child spawn. Does not clobber SSH_* / HOME if the
 * parent already set them (belt-and-suspenders with mcp.json / run-server.sh).
 */
export function agyChildEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const home = base.HOME && base.HOME.length > 0 ? base.HOME : homedir();
  return {
    ...base,
    HOME: home,
    SSH_CONNECTION: base.SSH_CONNECTION || AGY_SSH_CONNECTION,
    SSH_CLIENT: base.SSH_CLIENT || AGY_SSH_CLIENT,
  };
}
