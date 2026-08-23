import { z } from "zod";
import { runAgy, formatChainExhausted } from "../run-agy.js";
import { slugsFor, validateChain, MODEL_CHAINS } from "../models.js";
import { checkRefuse } from "../safety.js";

export const adversarialReviewSchema = {
  prompt: z
    .string()
    .describe(
      "Plan or code to critique adversarially (non-secret). Point at paths, don't paste bodies.",
    ),
  add_dir: z
    .string()
    .optional()
    .describe("Directory to grant agy read access to (defaults to workspace root)."),
};

export async function adversarialReview(
  input: { prompt: string; add_dir?: string },
  workspaceRoot: string,
) {
  const refuse = checkRefuse(input.prompt);
  if (refuse.refused) return { ok: false, text: refuse.reason! };

  const critiquePrompt = `Adversarial review — find the weakest points, missing edge cases, and risks. Be blunt and specific.\n\n${input.prompt}`;

  const models = await validateChain(slugsFor(MODEL_CHAINS.adversarial_review));
  const result = await runAgy({
    models,
    prompt: critiquePrompt,
    addDir: input.add_dir ?? workspaceRoot,
  });

  if (!result.ok) {
    return {
      ok: false,
      text: formatChainExhausted("adversarial_review", result.attempts),
    };
  }
  return { ok: true, text: result.output };
}
