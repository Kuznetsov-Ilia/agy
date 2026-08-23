#!/usr/bin/env node
// Debug CLI: node dist/cli.js <tool> '<json-input>'
import { analyzeFiles } from "./tools/analyze_files.js";
import { deepSearch } from "./tools/deep_search.js";
import { adversarialReview } from "./tools/adversarial_review.js";
import { followUp } from "./tools/follow_up.js";
import { delegate } from "./tools/delegate.js";
import { agyDoctor } from "./tools/agy_doctor.js";
import { agyQuota } from "./tools/agy_quota.js";
import { workspaceRoot } from "./workspace.js";

const WORKSPACE_ROOT = workspaceRoot();

async function main() {
  const [tool, jsonArg] = process.argv.slice(2);
  if (tool === "pool") {
    // Re-enter as pool-cli with ensure|status|...
    process.argv = [process.argv[0]!, process.argv[1]!, ...process.argv.slice(3)];
    await import("./pool-cli.js");
    return;
  }
  const input = jsonArg ? JSON.parse(jsonArg) : {};

  let result: { ok: boolean; text: string };
  switch (tool) {
    case "analyze_files":
      result = await analyzeFiles(input, WORKSPACE_ROOT);
      break;
    case "deep_search":
      result = await deepSearch(input, WORKSPACE_ROOT);
      break;
    case "adversarial_review":
      result = await adversarialReview(input, WORKSPACE_ROOT);
      break;
    case "follow_up":
      result = await followUp(input, WORKSPACE_ROOT);
      break;
    case "delegate":
      result = await delegate(input, WORKSPACE_ROOT);
      break;
    case "agy_doctor":
      result = await agyDoctor();
      break;
    case "agy_quota":
      result = await agyQuota();
      break;
    default:
      console.error(
        `Usage: node cli.js <analyze_files|deep_search|adversarial_review|follow_up|delegate|agy_doctor|agy_quota> '<json-input>'`,
      );
      process.exit(2);
  }

  console.log(result.text);
  process.exit(result.ok ? 0 : 3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
