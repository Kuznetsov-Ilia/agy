import { z } from "zod";
import { runAgy, formatChainExhausted } from "../run-agy.js";
import { slugsFor, validateChain, MODEL_CHAINS } from "../models.js";
import { checkRefuse } from "../safety.js";

export const analyzeFilesSchema = {
  prompt: z
    .string()
    .describe(
      "What to analyze — describe the files/logs and the question. Do not paste file bodies; pass paths.",
    ),
  add_dir: z
    .string()
    .optional()
    .describe("Directory to grant agy read access to (defaults to workspace root)."),
};

export async function analyzeFiles(
  input: { prompt: string; add_dir?: string },
  workspaceRoot: string,
) {
  const refuse = checkRefuse(input.prompt);
  if (refuse.refused) return { ok: false, text: refuse.reason! };

  const models = await validateChain(slugsFor(MODEL_CHAINS.analyze_files));
  const result = await runAgy({
    models,
    prompt: input.prompt,
    addDir: input.add_dir ?? workspaceRoot,
  });

  if (!result.ok) {
    return { ok: false, text: formatChainExhausted("analyze_files", result.attempts) };
  }
  return { ok: true, text: result.output };
}
