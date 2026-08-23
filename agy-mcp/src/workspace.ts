/** Workspace root for --add-dir defaults. */
export function workspaceRoot(): string {
  return process.env.AGY_MCP_WORKSPACE_ROOT ?? process.cwd();
}
