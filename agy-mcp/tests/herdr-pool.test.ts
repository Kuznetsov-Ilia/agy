import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearLease, readLease, reapStaleLeases } from "../src/herdr-pool.js";
import { resolveTransport } from "../src/run-agy.js";

describe("herdr-pool leases", () => {
  it("reads, clears, and reaps stale leases under custom HOME", () => {
    const home = mkdtempSync(join(tmpdir(), "agy-pool-"));
    const leasePath = join(home, ".cache", "agy-pool", "leases");
    mkdirSync(leasePath, { recursive: true });

    const live = {
      worker: "agy1",
      leaseId: "a",
      pid: process.pid,
      leasedAt: new Date().toISOString(),
      resultPath: "/tmp/agy-pool/a.md",
    };
    writeFileSync(join(leasePath, "agy1.json"), JSON.stringify(live), { flag: "wx" });
    expect(readLease("agy1", home)?.leaseId).toBe("a");
    clearLease("agy1", home);
    expect(readLease("agy1", home)).toBeNull();

    writeFileSync(
      join(leasePath, "agy2.json"),
      JSON.stringify({ ...live, worker: "agy2", pid: 999_999_99 }),
    );
    expect(reapStaleLeases(home)).toContain("agy2");
    expect(readLease("agy2", home)).toBeNull();
  });
});

describe("resolveTransport", () => {
  it("always print; herdr/auto are retired", () => {
    expect(resolveTransport({})).toBe("print");
    expect(resolveTransport({ AGY_TRANSPORT: "print" })).toBe("print");
    expect(resolveTransport({ AGY_TRANSPORT: "herdr" })).toBe("print");
    expect(resolveTransport({ AGY_TRANSPORT: "auto" })).toBe("print");
  });
});

describe("herdr-pool control plane with mock runner", () => {
  function createMockRunner() {
    const executed: string[][] = [];
    const state = {
      workspaces: [{ label: "agy-pool", workspace_id: "wG", active_tab_id: "wG:t1" }],
      panes: [
        { pane_id: "wG:p1" },
        { pane_id: "wG:p2" },
        { pane_id: "wG:p3" },
        { pane_id: "wG:p4" },
        { pane_id: "wG:p5" },
      ],
      agents: [
        { agent: "agy", name: "agy1", pane_id: "wG:p1", agent_status: "idle", interactive_ready: true },
        { agent: "agy", name: "agy2", pane_id: "wG:p2", agent_status: "idle", interactive_ready: true },
      ] as any[],
      shellProcs: {
        "wG:p1": [{ name: "zsh", pid: 100 }],
        "wG:p2": [{ name: "zsh", pid: 200 }],
        "wG:p3": [{ name: "zsh", pid: 300 }],
        "wG:p4": [{ name: "zsh", pid: 400 }],
        "wG:p5": [{ name: "zsh", pid: 500 }],
      } as Record<string, any[]>,
    };

    const run = (args: string[]) => {
      executed.push(args);
      const cmd = args.join(" ");

      if (cmd === "status") {
        return { ok: true, stdout: "server: running\nstatus: running", stderr: "", code: 0 };
      }
      if (cmd === "workspace list") {
        return { ok: true, stdout: JSON.stringify({ result: { workspaces: state.workspaces } }), stderr: "", code: 0 };
      }
      if (args[0] === "pane" && args[1] === "list") {
        return { ok: true, stdout: JSON.stringify({ result: { panes: state.panes } }), stderr: "", code: 0 };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: JSON.stringify({ result: { agents: state.agents } }), stderr: "", code: 0 };
      }
      if (args[0] === "pane" && args[1] === "process-info") {
        const paneId = args[args.indexOf("--pane") + 1];
        const procs = state.shellProcs[paneId] ?? [{ name: "zsh", pid: 100 }];
        return {
          ok: true,
          stdout: JSON.stringify({
            result: {
              process_info: {
                shell_pid: 100,
                foreground_processes: procs,
              },
            },
          }),
          stderr: "",
          code: 0,
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        if (args.includes("--clear")) {
          const target = args[2];
          state.agents = state.agents.filter((a) => a.name !== target && a.pane_id !== target);
        } else {
          const target = args[2];
          const newName = args[3];
          const existing = state.agents.find((a) => a.pane_id === target || a.name === target);
          if (existing) {
            existing.name = newName;
          } else {
            state.agents.push({ agent: "agy", name: newName, pane_id: target, agent_status: "idle" });
          }
        }
        return { ok: true, stdout: JSON.stringify({ result: { ok: true } }), stderr: "", code: 0 };
      }
      if (args[0] === "agent" && args[1] === "start") {
        const name = args[2];
        const paneId = args[args.indexOf("--pane") + 1];
        state.agents.push({ agent: "agy", name, pane_id: paneId, agent_status: "idle", interactive_ready: true });
        return { ok: true, stdout: JSON.stringify({ result: { ok: true } }), stderr: "", code: 0 };
      }
      if (args[0] === "tab" && args[1] === "focus") {
        return { ok: true, stdout: JSON.stringify({ result: { ok: true } }), stderr: "", code: 0 };
      }
      if (args[0] === "pane" && args[1] === "send-keys") {
        return { ok: true, stdout: JSON.stringify({ result: { ok: true } }), stderr: "", code: 0 };
      }

      return { ok: true, stdout: JSON.stringify({ result: {} }), stderr: "", code: 0 };
    };

    return { run, executed, state };
  }

  it("statusPool maps panes by position even if agent is un-named", async () => {
    const { importPool } = await import("../src/herdr-pool.js").then((m) => ({ importPool: m }));
    const home = mkdtempSync(join(tmpdir(), "agy-status-"));
    const { run, state } = createMockRunner();
    // Agent in wG:p1 has no name
    state.agents = [
      { agent: "agy", pane_id: "wG:p1", agent_status: "idle" },
    ];

    const status = importPool.statusPool({ size: 2, run, home });
    expect(status.workspaceId).toBe("wG");
    expect(status.workers[0]?.name).toBe("agy1");
    expect(status.workers[0]?.pane_id).toBe("wG:p1");
    expect(status.workers[0]?.agent_status).toBe("idle");
    expect(status.workers[1]?.name).toBe("agy2");
    expect(status.workers[1]?.pane_id).toBe("wG:p2");
  });

  it("ensurePool renames un-named agy agent and starts missing workers", async () => {
    const { ensurePool } = await import("../src/herdr-pool.js");
    const home = mkdtempSync(join(tmpdir(), "agy-ensure-"));
    const { run, state, executed } = createMockRunner();
    // wG:p1 has unnamed agy agent, wG:p2 is empty shell
    state.agents = [
      { agent: "agy", pane_id: "wG:p1", agent_status: "idle" },
    ];

    const result = ensurePool({ size: 2, run, home });
    expect(result.workspaceId).toBe("wG");
    // Verify rename was called for wG:p1
    expect(executed.some((cmd) => cmd[0] === "agent" && cmd[1] === "rename" && cmd[2] === "wG:p1" && cmd[3] === "agy1")).toBe(true);
    // Verify start was called for agy2 in wG:p2
    expect(executed.some((cmd) => cmd[0] === "agent" && cmd[1] === "start" && cmd[2] === "agy2")).toBe(true);
  });

  it("restartWorker clears stale names, frees pane, and starts fresh worker", async () => {
    const { restartWorker } = await import("../src/herdr-pool.js");
    const home = mkdtempSync(join(tmpdir(), "agy-restart-"));
    const { run, state, executed } = createMockRunner();

    const worker = restartWorker(1, { run, home });
    expect(worker.name).toBe("agy1");
    expect(worker.pane_id).toBe("wG:p1");
    // Check that clear rename was executed before starting
    expect(executed.some((cmd) => cmd[0] === "agent" && cmd[1] === "rename" && cmd[2] === "agy1" && cmd[3] === "--clear")).toBe(true);
    expect(executed.some((cmd) => cmd[0] === "agent" && cmd[1] === "rename" && cmd[2] === "wG:p1" && cmd[3] === "--clear")).toBe(true);
    // Check that start was executed
    expect(executed.some((cmd) => cmd[0] === "agent" && cmd[1] === "start" && cmd[2] === "agy1")).toBe(true);
  });

  it("releaseWorker with clear:true prompts /clear after dropping the lease", async () => {
    const { releaseWorker, readLease } = await import("../src/herdr-pool.js");
    const home = mkdtempSync(join(tmpdir(), "agy-release-clear-"));
    const leasePath = join(home, ".cache", "agy-pool", "leases");
    mkdirSync(leasePath, { recursive: true });
    writeFileSync(
      join(leasePath, "agy1.json"),
      JSON.stringify({
        worker: "agy1",
        leaseId: "lease-1",
        pid: process.pid,
        leasedAt: new Date().toISOString(),
        resultPath: "/tmp/agy-pool/lease-1.md",
      }),
      { flag: "wx" },
    );
    const { run, executed } = createMockRunner();

    releaseWorker("agy1", { run, home, clear: true });

    expect(readLease("agy1", home)).toBeNull();
    expect(
      executed.some(
        (cmd) =>
          cmd[0] === "agent" &&
          cmd[1] === "prompt" &&
          cmd[2] === "agy1" &&
          cmd[3] === "/clear",
      ),
    ).toBe(true);
  });

  it("releaseWorker without clear does not prompt /clear", async () => {
    const { releaseWorker } = await import("../src/herdr-pool.js");
    const home = mkdtempSync(join(tmpdir(), "agy-release-noclear-"));
    const { run, executed } = createMockRunner();

    releaseWorker("agy1", { run, home });

    expect(
      executed.some(
        (cmd) =>
          cmd[0] === "agent" &&
          cmd[1] === "prompt" &&
          cmd[3] === "/clear",
      ),
    ).toBe(false);
  });
});
