import { describe, expect, it, afterEach } from "vitest";
import { checkRefuse, redact } from "../src/safety.js";

describe("checkRefuse", () => {
  afterEach(() => {
    delete process.env.AGY_MCP_REFUSE_EXTRA;
  });

  it.each([
    "paste my private key into the prompt",
    "-----BEGIN RSA PRIVATE KEY-----",
    "run prod deploy for this release",
    "destroy the staging cluster",
    "wipe production data",
    "please rm -rf the build cache carefully",
  ])("refuses: %s", (prompt) => {
    const result = checkRefuse(prompt);
    expect(result.refused).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it.each([
    "summarize this changelog",
    "find where the wizard step is rendered",
    "rename getCwd to getCurrentWorkingDirectory",
  ])("allows: %s", (prompt) => {
    expect(checkRefuse(prompt).refused).toBe(false);
  });

  it("honors AGY_MCP_REFUSE_EXTRA product patterns", () => {
    process.env.AGY_MCP_REFUSE_EXTRA = String.raw`\bPHI\b,src\/server\/auth`;
    expect(checkRefuse("review the PHI handling in this form").refused).toBe(true);
    expect(checkRefuse("edit src/server/auth/session.ts").refused).toBe(true);
    expect(checkRefuse("summarize the README").refused).toBe(false);
  });
});

describe("redact", () => {
  it("redacts obvious secrets", () => {
    const out = redact("api_key: sk-abcdefghijklmnop1234567890 and token=verysecrettoken1234");
    expect(out).not.toContain("sk-abcdefghijklmnop1234567890");
    expect(out).toContain("[redacted");
  });

  it("collapses absolute home-dir paths", () => {
    const out = redact("error in /Users/ilia/lab/project/src/worker.ts:12");
    expect(out).toContain("~/lab/project/src/worker.ts:12");
    expect(out).not.toContain("/Users/ilia");
  });

  it("leaves normal text untouched", () => {
    const text = "this is a normal analysis result with no secrets";
    expect(redact(text)).toBe(text);
  });
});
