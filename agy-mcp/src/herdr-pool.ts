// Herdr warm-pool control plane for agy-mcp.
// Lease state lives under ~/.cache/agy-pool so it survives Cursor/MCP restarts.
// Herdr panes remain source of truth for idle/working/blocked.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const POOL_LABEL = "agy-pool";
export const DEFAULT_POOL_SIZE = 5;

export function poolSize(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AGY_POOL_SIZE ?? DEFAULT_POOL_SIZE);
  return Number.isFinite(n) && n >= 1 && n <= 16 ? Math.floor(n) : DEFAULT_POOL_SIZE;
}

export function cacheDir(home = process.env.HOME ?? homedir()): string {
  return join(home, ".cache", "agy-pool");
}

export function leasesDir(home = process.env.HOME ?? homedir()): string {
  return join(cacheDir(home), "leases");
}

export function resultDir(): string {
  return join("/tmp", "agy-pool");
}

export function workerName(i: number): string {
  return `agy${i}`;
}

export interface LeaseRecord {
  worker: string;
  leaseId: string;
  pid: number;
  leasedAt: string;
  resultPath: string;
}

export interface WorkerStatus {
  name: string;
  pane_id?: string;
  agent_status?: string;
  lease: LeaseRecord | null;
  interactive_ready?: boolean;
}

export type HerdrRunner = (args: string[]) => {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
};

export type AsyncHerdrRunner = (
  args: string[],
) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>;

function defaultHerdr(args: string[]) {
  const proc = spawnSync("herdr", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: proc.status === 0,
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
    code: proc.status,
  };
}

/** Non-blocking herdr — required so parallel pool leases can overlap in one MCP process. */
function defaultHerdrAsync(args: string[]): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolve) => {
    const child = spawn("herdr", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
      });
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        stdout: stdout.trim(),
        stderr: stderr + String(err),
        code: -1,
      });
    });
  });
}

export function herdrAvailable(run: HerdrRunner = defaultHerdr): boolean {
  if (!existsSync(join(homedir(), ".config", "herdr", "herdr.sock"))) {
    // still try — socket path can vary
  }
  const res = run(["status"]);
  return res.ok && /server:/.test(res.stdout) && /status:\s*running/.test(res.stdout);
}

function parseJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function herdrResult(run: HerdrRunner, args: string[]): any {
  const res = run(args);
  if (!res.ok) {
    throw new Error(`herdr ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  const parsed = parseJson(res.stdout);
  if (!parsed) {
    throw new Error(`herdr ${args.join(" ")} returned non-JSON`);
  }
  return parsed.result ?? parsed;
}

function ensureDirs(home = process.env.HOME ?? homedir()): void {
  mkdirSync(leasesDir(home), { recursive: true });
  mkdirSync(resultDir(), { recursive: true });
  mkdirSync(cacheDir(home), { recursive: true });
}

export function readLease(
  worker: string,
  home = process.env.HOME ?? homedir(),
): LeaseRecord | null {
  const path = join(leasesDir(home), `${worker}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LeaseRecord;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Drop leases whose holder PID is gone. */
export function reapStaleLeases(home = process.env.HOME ?? homedir()): string[] {
  ensureDirs(home);
  const cleared: string[] = [];
  for (const file of readdirSync(leasesDir(home))) {
    if (!file.endsWith(".json")) continue;
    const worker = file.replace(/\.json$/, "");
    const lease = readLease(worker, home);
    if (!lease) continue;
    if (!pidAlive(lease.pid)) {
      try {
        unlinkSync(join(leasesDir(home), file));
        cleared.push(worker);
      } catch {
        // race
      }
    }
  }
  return cleared;
}

function writeLeaseAtomic(lease: LeaseRecord, home = process.env.HOME ?? homedir()): boolean {
  ensureDirs(home);
  const finalPath = join(leasesDir(home), `${lease.worker}.json`);
  try {
    writeFileSync(finalPath, `${JSON.stringify(lease, null, 2)}\n`, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export function clearLease(
  worker: string,
  home = process.env.HOME ?? homedir(),
): void {
  const path = join(leasesDir(home), `${worker}.json`);
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

function listPoolAgents(run: HerdrRunner, size: number): any[] {
  const result = herdrResult(run, ["agent", "list"]);
  const agents = Array.isArray(result.agents) ? result.agents : [];
  const wanted = new Set(Array.from({ length: size }, (_, i) => workerName(i + 1)));
  return agents.filter((a: any) => a?.name && wanted.has(a.name));
}

function findPoolWorkspace(run: HerdrRunner): any | null {
  const result = herdrResult(run, ["workspace", "list"]);
  const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
  return workspaces.find((w: any) => w.label === POOL_LABEL) ?? null;
}

function listPanes(run: HerdrRunner, workspaceId: string): any[] {
  const result = herdrResult(run, ["pane", "list", "--workspace", workspaceId]);
  return Array.isArray(result.panes) ? result.panes : [];
}

function paneIsShell(run: HerdrRunner, paneId: string): boolean {
  try {
    const info = herdrResult(run, ["pane", "process-info", "--pane", paneId]);
    const procs = info?.process_info?.foreground_processes ?? [];
    const name = procs[0]?.name ?? "";
    return name === "zsh" || name === "bash" || name === "sh" || name === "-zsh";
  } catch {
    return false;
  }
}

function sleep(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)], { stdio: "ignore" });
}

function waitForShell(run: HerdrRunner, paneId: string, timeoutMs = 15_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (paneIsShell(run, paneId)) return true;
    sleep(400);
  }
  return paneIsShell(run, paneId);
}

function growPanes(run: HerdrRunner, workspaceId: string, size: number): string[] {
  let panes = listPanes(run, workspaceId);
  while (panes.length < size) {
    const from = panes[panes.length - 1]?.pane_id;
    if (!from) throw new Error("agy-pool: no pane to split");
    const direction = panes.length % 2 === 1 ? "right" : "down";
    const split = herdrResult(run, [
      "pane",
      "split",
      "--pane",
      from,
      "--direction",
      direction,
      "--no-focus",
    ]);
    const newId = split?.pane?.pane_id;
    if (!newId) throw new Error("agy-pool: pane split returned no pane_id");
    panes = listPanes(run, workspaceId);
  }
  return panes
    .map((p: any) => p.pane_id as string)
    .filter(Boolean)
    .sort()
    .slice(0, size);
}

function clearAgentName(run: HerdrRunner, target: string): void {
  try {
    run(["agent", "rename", target, "--clear"]);
  } catch {
    // ignore if target is not found or not named
  }
}

function freePane(run: HerdrRunner, paneId: string, timeoutMs = 15_000): boolean {
  if (paneIsShell(run, paneId)) return true;

  // Try graceful key interrupts first
  try {
    run(["pane", "send-keys", paneId, "ctrl+c"]);
  } catch {
    // ignore
  }
  sleep(200);

  if (paneIsShell(run, paneId)) return true;

  // Inspect process info to terminate non-shell foreground processes
  try {
    const info = herdrResult(run, ["pane", "process-info", "--pane", paneId]);
    const shellPid = info?.process_info?.shell_pid;
    const procs = info?.process_info?.foreground_processes ?? [];
    for (const p of procs) {
      if (p.pid && p.pid !== shellPid) {
        try {
          process.kill(p.pid, "SIGTERM");
        } catch {
          // already dead or permissions
        }
      }
    }
  } catch {
    // fallback
  }

  // Wait a moment for SIGTERM
  const start = Date.now();
  while (Date.now() - start < 1500) {
    if (paneIsShell(run, paneId)) return true;
    sleep(200);
  }

  // If still not shell, force kill remaining non-shell foreground processes
  try {
    const info = herdrResult(run, ["pane", "process-info", "--pane", paneId]);
    const shellPid = info?.process_info?.shell_pid;
    const procs = info?.process_info?.foreground_processes ?? [];
    for (const p of procs) {
      if (p.pid && p.pid !== shellPid) {
        try {
          process.kill(p.pid, "SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return waitForShell(run, paneId, Math.max(1000, timeoutMs - 2000));
}

function startWorker(
  run: HerdrRunner,
  name: string,
  paneId: string,
  skipPermissions: boolean,
): void {
  if (!freePane(run, paneId)) {
    throw new Error(`agy-pool: pane ${paneId} not at shell for ${name}`);
  }
  clearAgentName(run, name);
  clearAgentName(run, paneId);
  const args = [
    "agent",
    "start",
    name,
    "--kind",
    "agy",
    "--pane",
    paneId,
    "--timeout",
    "60000",
  ];
  if (skipPermissions) {
    args.push("--", "--dangerously-skip-permissions");
  }
  herdrResult(run, args);
}

export interface EnsureResult {
  workspaceId: string;
  workers: WorkerStatus[];
  createdWorkspace: boolean;
}

export function ensurePool(
  opts: {
    size?: number;
    cwd?: string;
    skipPermissions?: boolean;
    run?: HerdrRunner;
    home?: string;
  } = {},
): EnsureResult {
  const run = opts.run ?? defaultHerdr;
  const size = opts.size ?? poolSize();
  const home = opts.home ?? process.env.HOME ?? homedir();
  const cwd = opts.cwd ?? process.cwd();
  const skipPermissions = opts.skipPermissions ?? true;
  ensureDirs(home);
  reapStaleLeases(home);

  if (!herdrAvailable(run)) {
    throw new Error("agy-pool: herdr server not available");
  }

  let createdWorkspace = false;
  let ws = findPoolWorkspace(run);
  if (!ws) {
    const created = herdrResult(run, [
      "workspace",
      "create",
      "--cwd",
      cwd,
      "--label",
      POOL_LABEL,
      "--no-focus",
    ]);
    ws = created.workspace;
    createdWorkspace = true;
    if (!ws?.workspace_id) throw new Error("agy-pool: workspace create failed");
  }

  const workspaceId = ws.workspace_id as string;
  // Mark tab seen once so later background prompts aren't stalled.
  const tabId = ws.active_tab_id as string | undefined;
  if (tabId) {
    run(["tab", "focus", tabId]);
  }

  const paneIds = growPanes(run, workspaceId, size);
  let allAgents: any[] = [];
  try {
    const result = herdrResult(run, ["agent", "list"]);
    allAgents = Array.isArray(result.agents) ? result.agents : [];
  } catch {
    allAgents = [];
  }

  for (let i = 1; i <= size; i++) {
    const name = workerName(i);
    const paneId = paneIds[i - 1];

    const agentInPane = allAgents.find((a: any) => a.pane_id === paneId);
    const agentNamed = allAgents.find((a: any) => a.name === name);

    if (agentNamed && agentNamed.pane_id !== paneId) {
      clearAgentName(run, name);
    }

    if (agentInPane) {
      if (
        agentInPane.name === name &&
        agentInPane.agent_status &&
        agentInPane.agent_status !== "unknown"
      ) {
        continue;
      }
      if (agentInPane.agent === "agy") {
        try {
          run(["agent", "rename", paneId, name]);
          continue;
        } catch {
          // fallback to starting below
        }
      } else {
        throw new Error(
          `agy-pool: pane ${paneId} occupied by ${agentInPane.name ?? agentInPane.agent}; run restart ${i}`,
        );
      }
    }

    startWorker(run, name, paneId, skipPermissions);
  }

  // Re-focus caller's tab if we can detect it via env
  const callerTab = process.env.HERDR_TAB_ID;
  if (callerTab && callerTab !== tabId) {
    run(["tab", "focus", callerTab]);
  }

  return {
    workspaceId,
    createdWorkspace,
    workers: statusPool({ size, run, home }).workers,
  };
}

export function statusPool(
  opts: {
    size?: number;
    run?: HerdrRunner;
    home?: string;
  } = {},
): { workspaceId: string | null; workers: WorkerStatus[] } {
  const run = opts.run ?? defaultHerdr;
  const size = opts.size ?? poolSize();
  const home = opts.home ?? process.env.HOME ?? homedir();
  ensureDirs(home);
  reapStaleLeases(home);

  let workspaceId: string | null = null;
  try {
    workspaceId = findPoolWorkspace(run)?.workspace_id ?? null;
  } catch {
    workspaceId = null;
  }

  let paneIds: string[] = [];
  if (workspaceId) {
    try {
      paneIds = listPanes(run, workspaceId)
        .map((p: any) => p.pane_id as string)
        .filter(Boolean)
        .sort();
    } catch {
      paneIds = [];
    }
  }

  let liveAgents: any[] = [];
  try {
    const result = herdrResult(run, ["agent", "list"]);
    liveAgents = Array.isArray(result.agents) ? result.agents : [];
  } catch {
    liveAgents = [];
  }

  const workers: WorkerStatus[] = [];
  for (let i = 1; i <= size; i++) {
    const name = workerName(i);
    const expectedPaneId = paneIds[i - 1];
    const agent =
      liveAgents.find((a: any) => a.name === name) ??
      (expectedPaneId
        ? liveAgents.find((a: any) => a.pane_id === expectedPaneId)
        : undefined);

    workers.push({
      name,
      pane_id: agent?.pane_id ?? expectedPaneId,
      agent_status: agent?.agent_status,
      interactive_ready: agent?.interactive_ready,
      lease: readLease(name, home),
    });
  }
  return { workspaceId, workers };
}

export async function leaseWorker(
  opts: {
    size?: number;
    run?: HerdrRunner;
    home?: string;
    waitMs?: number;
  } = {},
): Promise<LeaseRecord | null> {
  const run = opts.run ?? defaultHerdr;
  const size = opts.size ?? poolSize();
  const home = opts.home ?? process.env.HOME ?? homedir();
  const waitMs = opts.waitMs ?? Number(process.env.AGY_POOL_LEASE_MS ?? 3_000);
  ensureDirs(home);
  reapStaleLeases(home);

  const deadline = Date.now() + Math.max(0, waitMs);
  do {
    const { workers } = statusPool({ size, run, home });
    for (const w of workers) {
      if (w.lease) continue;
      if (w.agent_status !== "idle" && w.agent_status !== "done") continue;
      const leaseId = randomUUID();
      const lease: LeaseRecord = {
        worker: w.name,
        leaseId,
        pid: process.pid,
        leasedAt: new Date().toISOString(),
        resultPath: join(resultDir(), `${leaseId}.md`),
      };
      if (writeLeaseAtomic(lease, home)) return lease;
    }
    if (Date.now() >= deadline) break;
    await delay(200);
  } while (Date.now() < deadline);

  return null;
}

export function releaseWorker(
  worker: string,
  opts: {
    run?: HerdrRunner;
    home?: string;
    clear?: boolean;
  } = {},
): void {
  const run = opts.run ?? defaultHerdr;
  const home = opts.home ?? process.env.HOME ?? homedir();
  clearLease(worker, home);
  if (opts.clear) {
    // Best-effort interactive reset; ignore failures.
    try {
      run(["agent", "prompt", worker, "/clear", "--wait", "--timeout", "15000"]);
    } catch {
      // ignore
    }
  }
}

export function restartWorker(
  n: number,
  opts: {
    run?: HerdrRunner;
    home?: string;
    skipPermissions?: boolean;
    cwd?: string;
  } = {},
): WorkerStatus {
  const run = opts.run ?? defaultHerdr;
  const home = opts.home ?? process.env.HOME ?? homedir();
  const name = workerName(n);
  clearLease(name, home);

  const ws = findPoolWorkspace(run);
  if (!ws) {
    ensurePool({
      run,
      home,
      cwd: opts.cwd,
      skipPermissions: opts.skipPermissions,
    });
    return statusPool({ run, home }).workers.find((x) => x.name === name)!;
  }

  const paneIds = growPanes(run, ws.workspace_id, Math.max(n, poolSize()));
  const paneId = paneIds[n - 1];
  if (!paneId) {
    throw new Error(`agy-pool: could not resolve pane for worker ${name}`);
  }

  clearAgentName(run, name);
  clearAgentName(run, paneId);

  if (!freePane(run, paneId, 20_000)) {
    throw new Error(`agy-pool: could not free pane ${paneId} for ${name}`);
  }

  startWorker(run, name, paneId, opts.skipPermissions ?? true);
  return statusPool({ run, home }).workers.find((x) => x.name === name)!;
}

export function focusedTabId(run: HerdrRunner = defaultHerdr): string | null {
  try {
    const result = herdrResult(run, ["workspace", "list"]);
    const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
    const focused = workspaces.find((w: any) => w.focused);
    return focused?.active_tab_id ?? null;
  } catch {
    return null;
  }
}

export async function promptWorker(
  worker: string,
  text: string,
  opts: {
    run?: HerdrRunner;
    runAsync?: AsyncHerdrRunner;
    timeoutMs?: number;
    restoreTabId?: string | null;
  } = {},
): Promise<{ ok: boolean; status?: string; error?: string; raw: string }> {
  const run = opts.run ?? defaultHerdr;
  const runAsync = opts.runAsync ?? defaultHerdrAsync;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.AGY_TIMEOUT_MS ?? 360_000);
  const restore =
    opts.restoreTabId === undefined ? focusedTabId(run) : opts.restoreTabId;

  // Mark seen so prompt isn't stalled on never-focused tabs (sync, cheap).
  run(["agent", "focus", worker]);

  const res = await runAsync([
    "agent",
    "prompt",
    worker,
    text,
    "--wait",
    "--timeout",
    String(timeoutMs),
  ]);

  if (restore) {
    run(["tab", "focus", restore]);
  }

  const parsed = parseJson(res.stdout) ?? parseJson(res.stderr);
  if (!res.ok) {
    const err =
      parsed?.error?.message ||
      parsed?.error?.code ||
      res.stderr ||
      res.stdout ||
      "prompt failed";
    return { ok: false, error: String(err), raw: res.stderr || res.stdout };
  }
  const status = parsed?.result?.agent?.agent_status as string | undefined;
  if (status === "blocked") {
    return {
      ok: false,
      status,
      error: "agent blocked (permission/question UI)",
      raw: res.stdout,
    };
  }
  return { ok: true, status, raw: res.stdout };
}

export function cleanupResultFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // ignore
  }
}
