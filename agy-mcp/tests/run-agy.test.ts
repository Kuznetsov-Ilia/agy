import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  runAgy,
  DEFAULT_MAX_BYTES,
  DEFAULT_PRINT_TIMEOUT,
  DEFAULT_TIMEOUT_MS,
  markModelCooldown,
  isModelCoolingDown,
  resetCooldownsForTests,
  looksLikeAuthFailure,
  looksLikePrintTimeout,
  skipPermissionsEnabled,
  formatChainExhausted,
} from "../src/run-agy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

describe("looksLikeAuthFailure", () => {
  it("matches LoadToken / silent auth patterns", () => {
    expect(looksLikeAuthFailure("Keyring LoadToken timed out")).toBe(true);
    expect(looksLikeAuthFailure("silent auth failed")).toBe(true);
    expect(looksLikeAuthFailure("You are not logged into Antigravity")).toBe(true);
    expect(looksLikeAuthFailure("quota exceeded 429")).toBe(false);
  });
});

describe("looksLikePrintTimeout", () => {
  it("matches CLI print-mode timeout text", () => {
    expect(
      looksLikePrintTimeout("Print mode: timed out after 597 polls (printed=84)"),
    ).toBe(true);
    expect(looksLikePrintTimeout("print-timeout after 300s")).toBe(true);
    expect(looksLikePrintTimeout("silent auth failed")).toBe(false);
  });
});

describe("skipPermissionsEnabled", () => {
  it("defaults on and respects AGY_SKIP_PERMISSIONS=0|false", () => {
    expect(skipPermissionsEnabled({})).toBe(true);
    expect(skipPermissionsEnabled({ AGY_SKIP_PERMISSIONS: "1" })).toBe(true);
    expect(skipPermissionsEnabled({ AGY_SKIP_PERMISSIONS: "0" })).toBe(false);
    expect(skipPermissionsEnabled({ AGY_SKIP_PERMISSIONS: "false" })).toBe(false);
  });
});

describe("formatChainExhausted", () => {
  it("includes last attempt errors so permission denials are visible", () => {
    const text = formatChainExhausted("deep_search", [
      { model: "flash-medium", error: "permission check failed for command git log" },
      { model: "flash-high", error: "user denied permission" },
    ]);
    expect(text).toContain("flash-medium -> flash-high");
    expect(text).toContain("permission check failed");
    expect(text).toContain("ON_FAILURE=strict");
  });
});

describe("runAgy", () => {
  it("passes --dangerously-skip-permissions by default", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-echo-args.mjs");
    delete process.env.AGY_SKIP_PERMISSIONS;
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(true);
    expect(result.output).toContain("--dangerously-skip-permissions");
  });

  it("omits --dangerously-skip-permissions when AGY_SKIP_PERMISSIONS=0", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-echo-args.mjs");
    process.env.AGY_SKIP_PERMISSIONS = "0";
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;
    delete process.env.AGY_SKIP_PERMISSIONS;

    expect(result.ok).toBe(true);
    expect(result.output).not.toContain("--dangerously-skip-permissions");
  });
  it("returns output with a provenance footer on success", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-ok.mjs");
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(true);
    expect(result.modelUsed).toBe("Flash High");
    expect(result.output).toContain("ok from Flash High");
    expect(result.output).toContain("model: Flash High | session: new | failover: 0");
  });

  it("retries the same model on transient auth failure before succeeding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-auth-"));
    const state = join(dir, "count");
    writeFileSync(state, "0");
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-auth-then-ok.mjs");
    process.env.AGY_AUTH_STATE = state;
    process.env.AGY_AUTH_FAIL_UNTIL = "2";
    process.env.AGY_AUTH_RETRIES = "3";
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;
    delete process.env.AGY_AUTH_STATE;
    delete process.env.AGY_AUTH_FAIL_UNTIL;
    delete process.env.AGY_AUTH_RETRIES;

    expect(result.ok).toBe(true);
    expect(result.modelUsed).toBe("Flash High");
    expect(result.output).toContain("after auth retries");
    expect(result.attempts).toHaveLength(1);
  });

  it("fails over to the next model on a 429-style quota error", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-fail-then-ok.mjs");
    const result = await runAgy({
      models: ["quota-exhausted-model", "healthy-model"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(true);
    expect(result.modelUsed).toBe("healthy-model");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].quota).toBe(true);
    expect(result.output).toContain("ok from healthy-model");
    expect(result.output).toContain("model: healthy-model");
    expect(result.output).toContain("failover: 1");
  });

  it("falls back to inline when every model in the chain fails", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-always-fail.mjs");
    const result = await runAgy({
      models: ["model-a", "model-b"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(false);
    expect(result.fellBackToInline).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => a.quota)).toBe(true);
  });

  it("returns fellBackToInline immediately for an empty model chain", async () => {
    const result = await runAgy({ models: [], prompt: "hello", addDir: "/tmp" });
    expect(result.ok).toBe(false);
    expect(result.fellBackToInline).toBe(true);
    expect(result.attempts).toHaveLength(0);
  });

  it("skips models still on per-process cooldown", async () => {
    resetCooldownsForTests();
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-ok.mjs");
    markModelCooldown("cooled", 60_000);
    expect(isModelCoolingDown("cooled")).toBe(true);
    const result = await runAgy({
      models: ["cooled", "Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;
    resetCooldownsForTests();

    expect(result.ok).toBe(true);
    expect(result.modelUsed).toBe("Flash High");
    expect(result.attempts[0]).toMatchObject({ model: "cooled", quota: true, error: "cooldown" });
  });

  it("truncates output over the byte cap and marks it in the footer", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-ok.mjs");
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      maxBytes: 5,
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(true);
    expect(result.output).toContain("truncated");
  });

  it("defaults the byte cap to 12288 when unset", () => {
    expect(DEFAULT_MAX_BYTES).toBe(12_288);
  });

  it("defaults print timeout 300s and wall timeout 360000ms", () => {
    expect(DEFAULT_PRINT_TIMEOUT).toBe("300s");
    expect(DEFAULT_TIMEOUT_MS).toBe(360_000);
  });

  it("returns partial output with partial|timed_out footer on print-timeout", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-print-timeout-partial.mjs");
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(true);
    expect(result.output).toContain("partial findings");
    expect(result.output).toContain("partial|timed_out");
    expect(result.attempts[0].error).toContain("print-timeout");
  });

  it("fails with print-timeout error and does not auth-retry on empty timeout", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-print-timeout-empty.mjs");
    process.env.AGY_AUTH_RETRIES = "3";
    const started = Date.now();
    const result = await runAgy({
      models: ["Flash High", "Flash Medium"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 5000,
    });
    const elapsed = Date.now() - started;
    delete process.env.AGY_BIN;
    delete process.env.AGY_AUTH_RETRIES;

    expect(result.ok).toBe(false);
    expect(result.fellBackToInline).toBe(true);
    // Stop chain after first print-timeout — no second model, no 3× auth retries.
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].error).toMatch(/print-timeout/i);
    expect(elapsed).toBeLessThan(4000);
  });

  it("returns partial stdout when wall-clock kill fires mid-run", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-hang.mjs");
    const result = await runAgy({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
      timeoutMs: 400,
    });
    delete process.env.AGY_BIN;

    expect(result.ok).toBe(true);
    expect(result.output).toContain("hanging partial");
    expect(result.output).toContain("partial|timed_out");
  });
});
