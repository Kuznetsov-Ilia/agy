#!/usr/bin/env node
// Emits partial stdout then hangs until SIGKILL (wall timeout).
process.stdout.write("hanging partial: found DueDiligenceDocumentSection\n");
setInterval(() => {}, 60_000);
