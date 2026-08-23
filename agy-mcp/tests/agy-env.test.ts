import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  agyChildEnv,
  agyOauthTokenPath,
  AGY_SSH_CLIENT,
  AGY_SSH_CONNECTION,
} from "../src/agy-env.js";

describe("agyChildEnv", () => {
  it("sets SSH_* and HOME when missing", () => {
    const env = agyChildEnv({ PATH: "/usr/bin" });
    expect(env.SSH_CONNECTION).toBe(AGY_SSH_CONNECTION);
    expect(env.SSH_CLIENT).toBe(AGY_SSH_CLIENT);
    expect(env.HOME).toBeTruthy();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("does not clobber existing SSH_* or HOME", () => {
    const env = agyChildEnv({
      HOME: "/custom/home",
      SSH_CONNECTION: "real",
      SSH_CLIENT: "real-client",
    });
    expect(env.HOME).toBe("/custom/home");
    expect(env.SSH_CONNECTION).toBe("real");
    expect(env.SSH_CLIENT).toBe("real-client");
  });

  it("resolves the canonical token path under HOME", () => {
    expect(agyOauthTokenPath("/tmp/h")).toBe(
      join("/tmp/h", ".gemini", "antigravity-cli", "antigravity-oauth-token"),
    );
  });

  it("honors AGY_OAUTH_TOKEN_PATH override", () => {
    process.env.AGY_OAUTH_TOKEN_PATH = "/tmp/custom-token";
    expect(agyOauthTokenPath()).toBe("/tmp/custom-token");
    delete process.env.AGY_OAUTH_TOKEN_PATH;
  });

  it("fills HOME from os.homedir when unset", () => {
    const env = agyChildEnv({ HOME: "" });
    expect(env.HOME).toBe(homedir());
  });
});
