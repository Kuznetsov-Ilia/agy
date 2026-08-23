import { z } from "zod";
import { runAgy, formatChainExhausted } from "../run-agy.js";
import { slugsFor, validateChain, MODEL_CHAINS } from "../models.js";
import { checkRefuse } from "../safety.js";

export const delegateSchema = {
  prompt: z
    .string()
    .describe(
      "Any other heavy text task (summary, rename plan, changelog draft) — not code-apply.",
    ),
  add_dir: z
    .string()
    .optional()
    .describe("Directory to grant agy read access to (defaults to workspace root)."),
  raw: z
    .boolean()
    .optional()
    .describe("Skip the compact-output contract when the full output IS the deliverable."),
};

export async function delegate(
  input: { prompt: string; add_dir?: string; raw?: boolean },
  workspaceRoot: string,
) {
  const refuse = checkRefuse(input.prompt);
  if (refuse.refused) return { ok: false, text: refuse.reason! };

  const models = await validateChain(slugsFor(MODEL_CHAINS.delegate));
  const result = await runAgy({
    models,
    prompt: input.prompt,
    addDir: input.add_dir ?? workspaceRoot,
    raw: input.raw,
  });

  if (!result.ok) {
    return { ok: false, text: formatChainExhausted("delegate", result.attempts) };
  }
  return { ok: true, text: result.output };
}
