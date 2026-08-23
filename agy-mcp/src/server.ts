#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { analyzeFiles, analyzeFilesSchema } from "./tools/analyze_files.js";
import { deepSearch, deepSearchSchema } from "./tools/deep_search.js";
import { adversarialReview, adversarialReviewSchema } from "./tools/adversarial_review.js";
import { followUp, followUpSchema } from "./tools/follow_up.js";
import { delegate, delegateSchema } from "./tools/delegate.js";
import { agyDoctor } from "./tools/agy_doctor.js";
import { agyQuota } from "./tools/agy_quota.js";
import { workspaceRoot } from "./workspace.js";

const WORKSPACE_ROOT = workspaceRoot();

function toResult(res: { ok: boolean; text: string }) {
  return {
    isError: !res.ok,
    content: [{ type: "text" as const, text: res.text }],
  };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "agy", version: "0.1.0" });

  server.registerTool(
    "analyze_files",
    {
      description:
        "Analyze >3 files, logs, or dumps via agy (Flash High -> Pro Low). Pass paths, not file bodies.",
      inputSchema: analyzeFilesSchema,
    },
    async (input) => toResult(await analyzeFiles(input, WORKSPACE_ROOT)),
  );

  server.registerTool(
    "deep_search",
    {
      description: "Repo grep / git archaeology across many files via agy (Flash Medium -> High).",
      inputSchema: deepSearchSchema,
    },
    async (input) => toResult(await deepSearch(input, WORKSPACE_ROOT)),
  );

  server.registerTool(
    "adversarial_review",
    {
      description:
        "Adversarial critique of a plan or code (non-secret) via agy (Pro High -> Sonnet Thinking).",
      inputSchema: adversarialReviewSchema,
    },
    async (input) => toResult(await adversarialReview(input, WORKSPACE_ROOT)),
  );

  server.registerTool(
    "follow_up",
    {
      description: "Continue a previous agy session by session_id, inheriting its model.",
      inputSchema: followUpSchema,
    },
    async (input) => toResult(await followUp(input, WORKSPACE_ROOT)),
  );

  server.registerTool(
    "delegate",
    {
      description: "Any other heavy text task via agy (Flash High). Not for code-apply — draft only.",
      inputSchema: delegateSchema,
    },
    async (input) => toResult(await delegate(input, WORKSPACE_ROOT)),
  );

  server.registerTool(
    "agy_doctor",
    {
      description: "Check agy binary/auth/models cache. No LLM call.",
      inputSchema: {},
    },
    async () => toResult(await agyDoctor()),
  );

  server.registerTool(
    "agy_quota",
    {
      description:
        "Sanitized remaining agy quota + reset time, read from the agy-hud cache. No LLM call.",
      inputSchema: {},
    },
    async () => toResult(await agyQuota()),
  );

  return server;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when run as the actual server entrypoint, not when
// imported by tests or the debug CLI.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error("agy-mcp fatal error:", err);
    process.exit(1);
  });
}
