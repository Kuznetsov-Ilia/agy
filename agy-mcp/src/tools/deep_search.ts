import { z } from "zod";
import { runAgy, formatChainExhausted } from "../run-agy.js";
import { slugsFor, validateChain, MODEL_CHAINS } from "../models.js";
import { checkRefuse } from "../safety.js";

export const deepSearchSchema = {
  prompt: z
    .string()
    .describe(
      "Repo grep / git archaeology question — e.g. 'where is X handled, across which files, and why'.",
    ),
  add_dir: z
    .string()
    .optional()
    .describe("Directory to grant agy read access to (defaults to workspace root)."),
};

export async function deepSearch(
  input: { prompt: string; add_dir?: string },
  workspaceRoot: string,
) {
  const refuse = checkRefuse(input.prompt);
  if (refuse.refused) return { ok: false, text: refuse.reason! };

  const models = await validateChain(slugsFor(MODEL_CHAINS.deep_search));
  const result = await runAgy({
    models,
    prompt: input.prompt,
    addDir: input.add_dir ?? workspaceRoot,
  });

  if (!result.ok) {
    return { ok: false, text: formatChainExhausted("deep_search", result.attempts) };
  }
  return { ok: true, text: result.output };
}
