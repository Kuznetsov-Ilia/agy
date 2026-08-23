import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseWorker = vi.fn();
const leaseWorker = vi.fn();
const promptWorker = vi.fn();
const cleanupResultFile = vi.fn();

vi.mock("../src/herdr-pool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/herdr-pool.js")>();
  return {
    ...actual,
    herdrAvailable: () => true,
    leaseWorker: (...args: unknown[]) => leaseWorker(...args),
    promptWorker: (...args: unknown[]) => promptWorker(...args),
    releaseWorker: (...args: unknown[]) => releaseWorker(...args),
    cleanupResultFile: (...args: unknown[]) => cleanupResultFile(...args),
  };
});

describe("herdr pool transport clears session on release", () => {
  beforeEach(() => {
    releaseWorker.mockReset();
    leaseWorker.mockReset();
    promptWorker.mockReset();
    cleanupResultFile.mockReset();
  });

  afterEach(() => {
    delete process.env.AGY_TRANSPORT;
    delete process.env.AGY_BIN;
  });

  it("calls releaseWorker with clear:true after a pool job", async () => {
    const resultDir = mkdtempSync(join(tmpdir(), "agy-pool-result-"));
    const resultPath = join(resultDir, "lease.md");
    writeFileSync(resultPath, "# answer\n");

    leaseWorker.mockResolvedValue({
      worker: "agy1",
      leaseId: "lease-uuid",
      pid: process.pid,
      leasedAt: new Date().toISOString(),
      resultPath,
    });
    promptWorker.mockResolvedValue({ ok: true, status: "idle", raw: "{}" });

    process.env.AGY_TRANSPORT = "herdr";
    process.env.AGY_BIN = "/usr/bin/agy";

    const { tryHerdrPoolTransport } = await import("../src/run-agy.js");
    const result = await tryHerdrPoolTransport({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
    });

    expect(result?.ok).toBe(true);
    expect(releaseWorker).toHaveBeenCalledWith("agy1", { clear: true });
  });
});
