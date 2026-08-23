// Sanitized quota snapshot — no LLM calls. Prefers the agy-hud cache
// (~/.cache/agy-hud/quota_cache.json). If missing/stale, optionally runs
// `node …/agy-hud.js quota refresh` when the plugin is installed.
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { redact } from "../safety.js";

const CACHE_PATH =
  process.env.AGY_QUOTA_CACHE ?? join(homedir(), ".cache", "agy-hud", "quota_cache.json");
const HUD_JS =
  process.env.AGY_HUD_JS ??
  join(homedir(), ".gemini", "config", "plugins", "agy-hud", "dist", "agy-hud.js");

async function tryRefresh(): Promise<boolean> {
  try {
    await access(HUD_JS);
  } catch {
    return false;
  }
  return await new Promise((resolve) => {
    const child = spawn("node", [HUD_JS, "quota", "refresh"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // gone
      }
      resolve(false);
    }, 12_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function summarize(parsed: unknown): string {
  const obj = parsed as Record<string, unknown>;
  const models = obj.models;
  if (models && typeof models === "object") {
    const lines: string[] = [];
    for (const [name, info] of Object.entries(models as Record<string, unknown>)) {
      if (!info || typeof info !== "object") continue;
      const m = info as Record<string, unknown>;
      let remaining: string | number = "?";
      if (typeof m.remainingFraction === "number") {
        remaining = `${Math.round(m.remainingFraction * 100)}%`;
      } else {
        remaining = (m.remaining ?? m.quota_remaining ?? m.left ?? "?") as string | number;
      }
      const reset = m.resetTime ?? m.reset_at ?? m.reset ?? "?";
      lines.push(`${name}: remaining=${remaining}, reset=${reset}`);
    }
    if (lines.length) {
      const updatedAt = obj.timestamp ?? obj.updated_at ?? obj.updatedAt ?? "unknown";
      const plan = obj.plan_name ?? obj.plan ?? "";
      const planBit = plan ? `plan=${plan}, ` : "";
      return `agy quota (${planBit}cache)\n${lines.join("\n")}\ncache updated: ${updatedAt}`;
    }
  }
  const remaining = obj.remaining ?? obj.quota_remaining ?? "unknown";
  const reset = obj.reset ?? obj.reset_at ?? obj.resetTime ?? "unknown";
  const updatedAt = obj.timestamp ?? obj.updated_at ?? obj.updatedAt ?? "unknown";
  return `agy quota — remaining: ${remaining}, resets: ${reset}, cache updated: ${updatedAt}`;
}

export async function agyQuota() {
  let raw: string | null = null;
  try {
    raw = await readFile(CACHE_PATH, "utf8");
  } catch {
    const refreshed = await tryRefresh();
    if (refreshed) {
      try {
        raw = await readFile(CACHE_PATH, "utf8");
      } catch {
        raw = null;
      }
    }
  }

  if (raw == null) {
    return {
      ok: false,
      text: `No agy-hud quota cache at ${redact(CACHE_PATH)}. Plugin install: curl release tarball → agy plugin install ./agy-hud, then in Antigravity CLI run:\n  /statusline ~/.gemini/config/plugins/agy-hud/hooks/status-line.sh\nOr: node ~/.gemini/config/plugins/agy-hud/dist/agy-hud.js quota refresh (requires local Antigravity server).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, text: `Quota cache at ${redact(CACHE_PATH)} is not valid JSON.` };
  }

  return { ok: true, text: summarize(parsed) };
}
