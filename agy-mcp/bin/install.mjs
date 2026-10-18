#!/usr/bin/env node
/**
 * Build agy-mcp and copy the Cursor plugin (skills/rules) into
 * ~/.cursor/plugins/local/agy-mcp. Does NOT install an MCP server —
 * Superlab `src/agy-pool` owns `mcpServers.agy`.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SRC = join(ROOT, "cursor-plugin");
const PLUGIN_DST = join(homedir(), ".cursor", "plugins", "local", "agy-mcp");
const MCP_JSON = join(homedir(), ".cursor", "mcp.json");
const SERVER_JS = join(ROOT, "dist", "server.js");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function ensureBuilt() {
  if (!existsSync(join(ROOT, "node_modules"))) {
    console.log("→ pnpm install");
    run("pnpm", ["install"]);
  }
  console.log("→ pnpm build");
  run("pnpm", ["build"]);
  if (!existsSync(SERVER_JS)) {
    console.error(`Missing ${SERVER_JS} after build`);
    process.exit(1);
  }
}

function removePluginDst() {
  const st = lstatSync(PLUGIN_DST, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isSymbolicLink()) {
    unlinkSync(PLUGIN_DST);
    return;
  }
  rmSync(PLUGIN_DST, { recursive: true, force: true });
}

function copyPlugin() {
  mkdirSync(dirname(PLUGIN_DST), { recursive: true });
  removePluginDst();
  cpSync(PLUGIN_SRC, PLUGIN_DST, { recursive: true });
  writeFileSync(
    join(PLUGIN_DST, "mcp.json"),
    `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
  );
  console.log(`→ plugin copied: ${PLUGIN_SRC} → ${PLUGIN_DST}`);
  console.log("  mcp.json is empty — Superlab UDS pool owns the agy MCP server");
}

ensureBuilt();
copyPlugin();
console.log(`→ skip ${MCP_JSON} — do not restore AGY_TRANSPORT=herdr`);

console.log(`
Done.

Skills/rules installed. MCP server is Superlab:
  bun run /path/to/superlab/src/agy-pool/mcp/server.ts

After editing plugin rules or skills, re-run: node bin/install.mjs
`);
