#!/usr/bin/env node
// Simulates CLI print-mode timeout with empty useful stdout.
process.stderr.write("Print mode: timed out after 597 polls (printed=84)\n");
process.stderr.write("You are not logged into Antigravity\n"); // side-channel noise
process.exit(1);
