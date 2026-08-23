#!/usr/bin/env node
// Simulates print-mode timeout after emitting useful stdout.
process.stdout.write("partial findings: src/lib/transfer-documents.ts\n");
process.stderr.write("Print mode: timed out after 598 polls (printed=98)\n");
process.exit(1);
