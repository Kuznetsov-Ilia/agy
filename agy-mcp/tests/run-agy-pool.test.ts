import { describe, expect, it } from "vitest";
import { tryHerdrPoolTransport } from "../src/run-agy.js";

describe("herdr pool transport retired", () => {
  it("never leases a pane", async () => {
    process.env.AGY_TRANSPORT = "herdr";
    const result = await tryHerdrPoolTransport({
      models: ["Flash High"],
      prompt: "hello",
      addDir: "/tmp",
    });
    expect(result).toBeNull();
  });
});
