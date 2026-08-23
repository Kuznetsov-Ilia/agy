import { z } from "zod";
import { runAgy } from "../run-agy.js";
import { checkRefuse } from "../safety.js";

export const followUpSchema = {
  session_id: z
    .string()
    .describe("agy conversation/session ID returned by a previous tool call footer."),
  prompt: z
    .string()
    .describe("Follow-up prompt — inherits the model/session from the original call."),
  model: z
    .string()
    .describe("The exact agy model slug the original session used (see the previous call's footer)."),
};

export async function followUp(
  input: { session_id: string; prompt: string; model: string },
  workspaceRoot: string,
) {
  const refuse = checkRefuse(input.prompt);
  if (refuse.refused) return { ok: false, text: refuse.reason! };

  const result = await runAgy({
    models: [input.model],
    prompt: input.prompt,
    addDir: workspaceRoot,
    sessionId: input.session_id,
  });

  if (!result.ok) {
    const detail = result.attempts
      .filter((a) => a.error)
      .map((a) => a.error!.replace(/\s+/g, " ").slice(0, 200))
      .join(" | ");
    const detailBit = detail ? ` Last errors: ${detail}.` : "";
    return {
      ok: false,
      text:
        `agy-mcp: follow_up on session ${input.session_id} failed.${detailBit} ` +
        `ON_FAILURE=strict — do not silently absorb this work inline; tell the user and ask how to proceed.`,
    };
  }
  return { ok: true, text: result.output };
}
