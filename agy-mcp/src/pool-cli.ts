#!/usr/bin/env node
// Control plane: agy-mcp-cli pool <ensure|status|lease|release|restart>
import {
  ensurePool,
  statusPool,
  leaseWorker,
  releaseWorker,
  restartWorker,
  poolSize,
  herdrAvailable,
} from "./herdr-pool.js";

function usage(): never {
  console.error(`Usage:
  node dist/pool-cli.js ensure [--cwd DIR] [--size N]
  node dist/pool-cli.js status [--size N]
  node dist/pool-cli.js lease [--wait-ms N]
  node dist/pool-cli.js release <agyN> [--clear]
  node dist/pool-cli.js restart <N>
`);
  process.exit(2);
}

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  if (!herdrAvailable() && cmd !== "status") {
    console.error("agy-pool: herdr server not available");
    process.exit(1);
  }

  switch (cmd) {
    case "ensure": {
      const size = Number(parseFlag(rest, "--size") ?? poolSize());
      const cwd = parseFlag(rest, "--cwd") ?? process.cwd();
      const result = ensurePool({ size, cwd });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "status": {
      const size = Number(parseFlag(rest, "--size") ?? poolSize());
      console.log(JSON.stringify(statusPool({ size }), null, 2));
      break;
    }
    case "lease": {
      const waitMs = Number(parseFlag(rest, "--wait-ms") ?? 3000);
      const lease = await leaseWorker({ waitMs });
      if (!lease) {
        console.error("agy-pool: no idle worker");
        process.exit(1);
      }
      console.log(JSON.stringify(lease, null, 2));
      break;
    }
    case "release": {
      const worker = rest.find((a) => !a.startsWith("--"));
      if (!worker) usage();
      releaseWorker(worker!, { clear: rest.includes("--clear") });
      console.log(JSON.stringify({ released: worker }, null, 2));
      break;
    }
    case "restart": {
      const n = Number(rest[0]);
      if (!Number.isFinite(n) || n < 1) usage();
      const worker = restartWorker(n);
      console.log(JSON.stringify(worker, null, 2));
      break;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
