#!/usr/bin/env node
// Fake agy binary: echoes argv flags for permission/skip assertions.
const args = process.argv.slice(2);
process.stdout.write(`args:${JSON.stringify(args)}\n`);
process.exit(0);
