// Shared runner: tries each model in a chain, kills the child on timeout,
// serializes concurrent agy spawns (Keychain/file token contention), and
// retries transient auth failures before failover.
// Herdr PTY lease transport (`AGY_TRANSPORT=herdr`, `/tmp/agy-pool`) is retired.
// Superlab owns the warm pool: `src/agy-pool` UDS daemon.
import { spawn } from "node:child_process";
import { agyChildEnv } from "./agy-env.js";
import { redact } from "./safety.js";

// Read lazily (not at module-eval time) so tests can swap AGY_BIN per case.
export function agyBin(): string {
  return process.env.AGY_BIN ?? "agy";
}
export const DEFAULT_MAX_BYTES = Number(process.env.AGY_MAX_BYTES ?? 12_288);
export const DEFAULT_PRINT_TIMEOUT = process.env.AGY_PRINT_TIMEOUT ?? "300s";
/** Hard wall-clock kill for the child. Must stay > print timeout (default 300s). */
export const DEFAULT_TIMEOUT_MS = Number(process.env.AGY_TIMEOUT_MS ?? 360_000);

/** Print-mode cannot prompt for tool confirmation; without this flag RunCommand
 * (e.g. git archaeology in deep_search) soft-denies and returns empty stdout.
 * Default on; set AGY_SKIP_PERMISSIONS=0|false to disable. */
export function skipPermissionsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = (env.AGY_SKIP_PERMISSIONS ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

/** Auth-related stderr/stdout patterns that warrant a same-model retry. */
const AUTH_RETRY_PATTERNS = [
  /silent auth failed/i,
  /not authenticated/i,
  /authentication timed out/i,
  /LoadToken timed out/i,
  /You are not logged into Antigravity/i,
];

/** CLI print-mode wall — not auth; must not trigger AUTH_RETRIES. */
const PRINT_TIMEOUT_PATTERNS = [
  /Print mode:\s*timed out/i,
  /\bprint-timeout\b/i,
];

const AUTH_RETRIES = Number(process.env.AGY_AUTH_RETRIES ?? 3);

export interface RunAgyOptions {
  /** Model slugs to try in order (already resolved via models.ts). */
  models: string[];
  prompt: string;
  /** Directory added via --add-dir (workspace root by default). */
  addDir: string;
  /** Resume/continue an existing agy conversation instead of starting fresh. */
  sessionId?: string;
  maxBytes?: number;
  printTimeout?: string;
  /** Skip the compact-output contract appended to the prompt. */
  raw?: boolean;
  /** Hard wall-clock timeout for the whole call, ms. Kills the child. */
  timeoutMs?: number;
}

export interface RunAgyResult {
  ok: boolean;
  output: string;
  modelUsed?: string;
  attempts: { model: string; error?: string; quota?: boolean }[];
  /** True when every model in the chain failed — caller must not silently do
   * the work inline without telling the human (ON_FAILURE=strict). */
  fellBackToInline: boolean;
}

/** Fail text for tools when every model in the chain failed. */
export function formatChainExhausted(
  tool: string,
  attempts: RunAgyResult["attempts"],
): string {
  const chain = attempts.map((a) => a.model).join(" -> ") || "(none)";
  const details = attempts
    .filter((a) => a.error)
    .map((a) => `${a.model}: ${a.error!.replace(/\s+/g, " ").slice(0, 200)}`)
    .join(" | ");
  const detailBit = details ? ` Last errors: ${details}.` : "";
  return (
    `agy-mcp: ${tool} exhausted all models (${chain}).${detailBit} ` +
    `ON_FAILURE=strict — do not silently absorb this work inline; tell the user and ask how to proceed.`
  );
}

const OUTPUT_CONTRACT = `\n\nOUTPUT CONTRACT (mandatory): Return ONLY the requested result, compact. \
No preamble, no restating the task, no code dumps unless explicitly asked; quote at most 10 \
lines per excerpt. Hard cap: ~150 lines total.`;

const QUOTA_PATTERNS = [/\b429\b/, /quota/i, /rate.?limit/i, /resource.?exhausted/i];

function looksLikeQuotaFailure(text: string): boolean {
  return QUOTA_PATTERNS.some((p) => p.test(text));
}

export function looksLikeAuthFailure(text: string): boolean {
  return AUTH_RETRY_PATTERNS.some((p) => p.test(text));
}

export function looksLikePrintTimeout(text: string): boolean {
  return PRINT_TIMEOUT_PATTERNS.some((p) => p.test(text));
}

function provenanceFooter(opts: {
  model: string;
  sessionId?: string;
  failover: number;
  truncated?: boolean;
  partialTimedOut?: boolean;
  transport?: string;
  worker?: string;
}): string {
  const bits = [
    `model: ${opts.model}`,
    `session: ${opts.sessionId ?? "new"}`,
    `failover: ${opts.failover}`,
  ];
  if (opts.transport) bits.push(`transport:${opts.transport}`);
  if (opts.worker) bits.push(`worker:${opts.worker}`);
  if (opts.truncated) bits.push("truncated");
  if (opts.partialTimedOut) bits.push("partial|timed_out");
  return `\n\n[${bits.join(" | ")}]`;
}

/** AGY_TRANSPORT is obsolete. Print is the only path in this package. */
export function resolveTransport(
  _env: NodeJS.ProcessEnv = process.env,
): "print" {
  return "print";
}

/** Retired: Superlab UDS pool replaced PTY lease. Always null → print. */
export async function tryHerdrPoolTransport(
  _opts: RunAgyOptions,
): Promise<RunAgyResult | null> {
  return null;
}

/** Per-process cooldown: models that just 429'd stay skipped until expiry. */
const modelCooldownUntil = new Map<string, number>();
const COOLDOWN_MS = Number(process.env.AGY_COOLDOWN_MS ?? 60_000);

export function markModelCooldown(model: string, ms = COOLDOWN_MS): void {
  modelCooldownUntil.set(model, Date.now() + ms);
}

export function isModelCoolingDown(model: string): boolean {
  const until = modelCooldownUntil.get(model);
  if (until == null) return false;
  if (Date.now() >= until) {
    modelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

export function resetCooldownsForTests(): void {
  modelCooldownUntil.clear();
}

/** One concurrent `agy` spawn per MCP process — avoids Keychain/file races. */
let spawnMutex: Promise<void> = Promise.resolve();

export function withAgyMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = spawnMutex;
  let release!: () => void;
  spawnMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(() => release());
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runOnce(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return withAgyMutex(
    () =>
      new Promise((resolve) => {
        const child = spawn(agyBin(), args, {
          env: agyChildEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            if (child.pid) child.kill("SIGKILL");
          } catch {
            // already gone
          }
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr, timedOut });
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
        });
      }),
  );
}

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return { text, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

export async function runAgy(opts: RunAgyOptions): Promise<RunAgyResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const printTimeout = opts.printTimeout ?? DEFAULT_PRINT_TIMEOUT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts: RunAgyResult["attempts"] = [];

  if (opts.models.length === 0) {
    return { ok: false, output: "", attempts, fellBackToInline: true };
  }

  const pooled = await tryHerdrPoolTransport(opts);
  if (pooled) return pooled;

  let prompt = opts.prompt;
  if (!opts.raw) prompt += OUTPUT_CONTRACT;

  for (const model of opts.models) {
    if (isModelCoolingDown(model)) {
      attempts.push({ model, error: "cooldown", quota: true });
      continue;
    }

    const base = opts.sessionId
      ? ["--model", model, "--conversation", opts.sessionId, "--print-timeout", printTimeout, "-p", prompt]
      : ["--model", model, "--add-dir", opts.addDir, "--print-timeout", printTimeout, "-p", prompt];
    const args = skipPermissionsEnabled()
      ? ["--dangerously-skip-permissions", ...base]
      : base;

    let result: SpawnResult | undefined;
    let lastCombined = "";
    for (let tryN = 1; tryN <= AUTH_RETRIES; tryN++) {
      result = await runOnce(args, timeoutMs);
      lastCombined = `${result.stdout}\n${result.stderr}`;
      if (result.code === 0 && result.stdout.trim().length > 0) break;
      // Print/wall timeout is not auth — never burn AUTH_RETRIES × timeoutMs.
      if (result.timedOut || looksLikePrintTimeout(lastCombined)) break;
      if (!looksLikeAuthFailure(lastCombined) || tryN === AUTH_RETRIES) break;
    }

    const quota = looksLikeQuotaFailure(lastCombined);
    const printTimedOut =
      Boolean(result?.timedOut) || looksLikePrintTimeout(lastCombined);

    if (result && result.code === 0 && result.stdout.trim().length > 0 && !printTimedOut) {
      const { text, truncated } = truncate(result.stdout.trim(), maxBytes);
      attempts.push({ model });
      return {
        ok: true,
        output:
          redact(text) +
          provenanceFooter({
            model,
            sessionId: opts.sessionId,
            failover: attempts.length - 1,
            truncated,
          }),
        modelUsed: model,
        attempts,
        fellBackToInline: false,
      };
    }

    // Honest partial: fat deep_search often dies mid-print with useful stdout.
    if (result && printTimedOut && result.stdout.trim().length > 0) {
      const { text, truncated } = truncate(result.stdout.trim(), maxBytes);
      attempts.push({ model, error: "print-timeout (partial)" });
      return {
        ok: true,
        output:
          redact(text) +
          provenanceFooter({
            model,
            sessionId: opts.sessionId,
            failover: attempts.length - 1,
            truncated,
            partialTimedOut: true,
          }),
        modelUsed: model,
        attempts,
        fellBackToInline: false,
      };
    }

    if (result && printTimedOut) {
      attempts.push({
        model,
        error: redact(
          `print-timeout after ${printTimeout} (wall ${timeoutMs}ms); stdout empty. ` +
            `Narrow add_dir, one concrete question, prefer follow_up. ` +
            `ON_FAILURE=strict — do not silently Grep/Read fan-out. ` +
            (result.stderr || result.stdout || "").slice(0, 300),
        ),
      });
      // Same fat prompt will burn the next model too — stop the chain.
      return { ok: false, output: "", attempts, fellBackToInline: true };
    }

    if (quota) markModelCooldown(model);

    attempts.push({
      model,
      error: redact((result?.stderr || result?.stdout || "empty output").slice(0, 500)),
      quota,
    });
  }

  return { ok: false, output: "", attempts, fellBackToInline: true };
}
