import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agyDoctor, inspectOauthTokenFile } from "../src/tools/agy_doctor.js";
import { resetModelsCacheForTests } from "../src/models.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const FAKE_TOKEN = join(FIXTURES, "fake-oauth-token.json");

afterEach(() => {
  delete process.env.AGY_BIN;
  delete process.env.AGY_OAUTH_TOKEN_PATH;
  resetModelsCacheForTests();
});

describe("inspectOauthTokenFile", () => {
  it("reports missing without leaking paths as secrets", async () => {
    const status = await inspectOauthTokenFile(join(FIXTURES, "no-such-token.json"));
    expect(status.exists).toBe(false);
    expect(status.hasRefreshToken).toBe(false);
  });

  it("detects refresh_token without printing it", async () => {
    const status = await inspectOauthTokenFile(FAKE_TOKEN);
    expect(status.exists).toBe(true);
    expect(status.hasRefreshToken).toBe(true);
    expect(JSON.stringify(status)).not.toContain("test-refresh-token");
  });
});

describe("agyDoctor", () => {
  it("reports not found when the binary is missing", async () => {
    process.env.AGY_BIN = "/nonexistent/path/to/agy-binary-that-does-not-exist";
    process.env.AGY_OAUTH_TOKEN_PATH = FAKE_TOKEN;
    const result = await agyDoctor();
    expect(result.ok).toBe(false);
    expect(result.text).toContain("not found on PATH");
  });

  it("reports OK with file token + mocked models cache", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-models.mjs");
    process.env.AGY_OAUTH_TOKEN_PATH = FAKE_TOKEN;
    const result = await agyDoctor();
    expect(result.ok).toBe(true);
    expect(result.text).toContain("auth: OK (file token + models)");
    expect(result.text).toContain("fake-model-a");
    expect(result.text).toContain("refresh_token: yes");
    expect(result.text).not.toContain("test-refresh-token");
  });

  it("fails with SSH login hint when token file is missing", async () => {
    process.env.AGY_BIN = join(FIXTURES, "fake-agy-models.mjs");
    process.env.AGY_OAUTH_TOKEN_PATH = join(FIXTURES, "missing-oauth-token.json");
    const result = await agyDoctor();
    expect(result.ok).toBe(false);
    expect(result.text).toContain("token file: MISSING");
    expect(result.text).toContain("SSH_CONNECTION=");
  });
});
