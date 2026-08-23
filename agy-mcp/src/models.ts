// Model chains + a per-process cache of `agy models` (the CLI slugs it will
// actually accept via --model). We validate configured chains against the
// cache when available, but never block a call just because the cache lookup
// itself failed (agy binary missing is handled by the runner, not here).
import { spawn } from "node:child_process";
import { agyChildEnv } from "./agy-env.js";

function agyBin(): string {
  return process.env.AGY_BIN ?? "agy";
}

// Display-name -> agy CLI slug. Source of truth: `agy models` output on this
// machine (2026-08). Keep both names so tool definitions can stay readable.
export const MODEL_SLUG: Record<string, string> = {
  "Flash High": "gemini-3.7-flash-high",
  "Flash Medium": "gemini-3.7-flash-medium",
  "Flash Low": "gemini-3.7-flash-low",
  "Pro High": "gemini-3.1-pro-high",
  "Pro Low": "gemini-3.1-pro-low",
  "OSS Medium": "gpt-oss-120b-medium",
  "Sonnet Thinking": "claude-sonnet-4-6",
};

export type ModelChain = readonly string[];

// Tool -> ordered failover chain, expressed as display names from MODEL_SLUG.
export const MODEL_CHAINS = {
  analyze_files: ["Flash High", "Pro Low"],
  deep_search: ["Flash Medium", "Flash High"],
  adversarial_review: ["Pro High", "Sonnet Thinking"],
  delegate: ["Flash High"],
} as const satisfies Record<string, ModelChain>;

export function slugsFor(chain: ModelChain): string[] {
  return chain.map((name) => MODEL_SLUG[name] ?? name);
}

let cachedModels: string[] | null = null;
let cachePromise: Promise<string[]> | null = null;

/** Runs `agy models` once per process and caches the result. */
export async function getAvailableModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;
  if (cachePromise) return cachePromise;
  cachePromise = new Promise((resolve) => {
    // stdin must be closed ("ignore"), not left open as a pipe — agy hangs
    // waiting on stdin otherwise.
    const child = spawn(agyBin(), ["models"], {
      env: agyChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        resolve([]);
        return;
      }
      // `agy models` prints "Fetching…" then `slug\tDisplay Name` lines.
      const models = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^fetching\b/i.test(line))
        .map((line) => line.split(/\t/)[0]!.trim())
        .filter(Boolean);
      cachedModels = models;
      resolve(models);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
  return cachePromise;
}

/** Filters a slug chain down to slugs the cache confirms exist; if the cache
 * is empty (agy missing, or lookup failed) returns the chain unchanged so the
 * runner can still attempt it and surface the real error. */
export async function validateChain(slugs: string[]): Promise<string[]> {
  const available = await getAvailableModels();
  if (available.length === 0) return slugs;
  const known = slugs.filter((slug) => available.includes(slug));
  return known.length > 0 ? known : slugs;
}

export function resetModelsCacheForTests(): void {
  cachedModels = null;
  cachePromise = null;
}
