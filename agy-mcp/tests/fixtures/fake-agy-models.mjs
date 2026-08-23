#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "models") {
  process.stdout.write("fake-model-a\nfake-model-b\n");
  process.exit(0);
}
process.exit(1);
