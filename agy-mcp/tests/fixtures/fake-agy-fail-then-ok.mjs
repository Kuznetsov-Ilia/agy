#!/usr/bin/env node
// Fake agy: fails with a 429-style quota error for one model, succeeds for
// any other model. Used to exercise failover.
const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const model = modelIdx >= 0 ? args[modelIdx + 1] : "unknown";

if (model === "quota-exhausted-model") {
  process.stderr.write("Error: 429 RESOURCE_EXHAUSTED quota exceeded\n");
  process.exit(1);
}
process.stdout.write(`ok from ${model}\n`);
process.exit(0);
