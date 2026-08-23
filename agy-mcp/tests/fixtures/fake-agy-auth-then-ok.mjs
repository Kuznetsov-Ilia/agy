#!/usr/bin/env node
// Fail with auth stderr on first N calls, then succeed.
// Call count is stored in AGY_AUTH_STATE file (set by the test).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const statePath = process.env.AGY_AUTH_STATE;
if (!statePath) {
  console.error("AGY_AUTH_STATE required");
  process.exit(2);
}

let n = 0;
if (existsSync(statePath)) {
  n = Number(readFileSync(statePath, "utf8")) || 0;
}
n += 1;
writeFileSync(statePath, String(n));

const failUntil = Number(process.env.AGY_AUTH_FAIL_UNTIL ?? 2);
if (n <= failUntil) {
  console.error("LoadToken timed out … silent auth failed");
  process.exit(1);
}

const model = process.argv.includes("--model")
  ? process.argv[process.argv.indexOf("--model") + 1]
  : "unknown";
console.log(`ok from ${model} after auth retries`);
process.exit(0);
