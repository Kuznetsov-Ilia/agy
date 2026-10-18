#!/usr/bin/env node
// Retired: PTY lease pool (`/tmp/agy-pool`) is no longer used.
// Superlab owns the warm pool: `bun run agy-pool:ensure` in that repo.
const msg = `agy-mcp pool CLI is retired.
PTY lease + /tmp/agy-pool result files are gone.
Use Superlab UDS pool:
  cd <superlab> && bun run agy-pool:ensure
  bun run agy-pool:status
  bun run agy-pool:watch 1
`;
console.error(msg);
process.exit(2);
