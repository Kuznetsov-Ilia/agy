#!/usr/bin/env node
// Fake agy binary: succeeds and echoes the model name it was called with.
const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const model = modelIdx >= 0 ? args[modelIdx + 1] : "unknown";
process.stdout.write(`ok from ${model}\n`);
process.exit(0);
