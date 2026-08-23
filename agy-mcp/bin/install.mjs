#!/usr/bin/env node
/**
 * Build agy-mcp, copy the Cursor plugin into ~/.cursor/plugins/local/agy-mcp
 * (real directory — Cursor 3.15+ rejects local plugins whose symlink target
 * is outside that folder), rewrite the installed mcp.json to an absolute
 * run-server.sh, and merge the stdio server into ~/.cursor/mcp.json.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
const RUN_SERVER = join(ROOT, "bin", "run-server.sh");

const SSH_ENV = {
  SSH_CONNECTION: "127.0.0.1 22 127.0.0.1 22",
  SSH_CLIENT: "127.0.0.1 22 22",
};

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

function agyMcpEntry(prev) {
  const env = {
    ...SSH_ENV,
    AGY_PRINT_TIMEOUT: "300s",
    AGY_TIMEOUT_MS: "360000",
    AGY_TRANSPORT: "herdr",
    ON_FAILURE: "strict",
  };
  if (prev?.env && typeof prev.env === "object") {
    for (const key of [
      "AGY_TRANSPORT",
      "ON_FAILURE",
      "AGY_POOL_SIZE",
      "AGY_POOL_LEASE_MS",
      "AGY_MCP_WORKSPACE_ROOT",
      "AGY_BIN",
      "AGY_MAX_BYTES",
    ]) {
      if (prev.env[key] !== undefined) env[key] = prev.env[key];
    }
  }
  return {
    command: "bash",
    args: [RUN_SERVER],
    timeout: 600_000,
    env,
  };
}

function removePluginDst() {
  const st = lstatSync(PLUGIN_DST, { throwIfNoEntry: false });
  if (!st) return;
  // Never recursive-rm a symlink: some Node versions follow it into the source tree.
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
    `${JSON.stringify({ mcpServers: { agy: agyMcpEntry() } }, null, 2)}\n`,
  );
  console.log(`→ plugin copied: ${PLUGIN_SRC} → ${PLUGIN_DST}`);
  console.log(`  mcp.json args → ${RUN_SERVER}`);
}

function mergeUserMcp() {
  mkdirSync(dirname(MCP_JSON), { recursive: true });
  let doc = { mcpServers: {} };
  if (existsSync(MCP_JSON)) {
    try {
      doc = JSON.parse(readFileSync(MCP_JSON, "utf8"));
    } catch (err) {
      console.error(`Could not parse ${MCP_JSON}:`, err);
      process.exit(1);
    }
  }
  if (!doc.mcpServers || typeof doc.mcpServers !== "object") {
    doc.mcpServers = {};
  }

  const prev = doc.mcpServers.agy;
  doc.mcpServers.agy = agyMcpEntry(prev);

  const bak = `${MCP_JSON}.bak.${Date.now()}`;
  if (existsSync(MCP_JSON)) {
    renameSync(MCP_JSON, bak);
    console.log(`→ backed up ${MCP_JSON} → ${bak}`);
  }
  writeFileSync(MCP_JSON, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`→ merged agy into ${MCP_JSON}`);
  if (prev) {
    console.log("  (replaced previous mcpServers.agy entry)");
  }
}

ensureBuilt();
copyPlugin();
mergeUserMcp();

console.log(`
Done.

Next:
  1. Developer: Reload Window (or quit+reopen Cursor)
  2. Open a NEW Agent chat (stale sessions often miss stdio and plugin rules)
  3. Smoke: CallMcpTool server=agy toolName=agy_doctor
     CLI:  node ${join(ROOT, "dist/cli.js")} agy_doctor

After editing plugin rules or skills, re-run: node bin/install.mjs
(the install is a copy, not a live symlink).

Prerequisite — file auth (Keychain is unreliable for MCP/background):
  SSH_CONNECTION='127.0.0.1 22 127.0.0.1 22' SSH_CLIENT='127.0.0.1 22 22' agy
  test -f ~/.gemini/antigravity-cli/antigravity-oauth-token

If agy_doctor reports a missing token file or empty models, run the login above once.
`);
