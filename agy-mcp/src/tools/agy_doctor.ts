// Environment sanity check — no LLM calls. Confirms the agy binary is on
// PATH, that the oauth token file exists (file-auth path), and that
// authentication works via `agy models`.
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { agyChildEnv, agyOauthTokenPath, AGY_SSH_CLIENT, AGY_SSH_CONNECTION } from "../agy-env.js";
import { getAvailableModels } from "../models.js";

function agyBin(): string {
  return process.env.AGY_BIN ?? "agy";
}

function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("which", [bin], { env: agyChildEnv() }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

export interface TokenFileStatus {
  path: string;
  exists: boolean;
  modeOctal?: string;
  hasRefreshToken: boolean;
  error?: string;
}

/** Inspect oauth token file without printing secrets. */
export async function inspectOauthTokenFile(
  path = agyOauthTokenPath(),
): Promise<TokenFileStatus> {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    return {
      path,
      exists: false,
      hasRefreshToken: false,
      error: "missing",
    };
  }

  let modeOctal: string | undefined;
  try {
    const st = await stat(path);
    modeOctal = (st.mode & 0o777).toString(8).padStart(3, "0");
  } catch {
    // ignore mode probe failures
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { token?: { refresh_token?: unknown }; refresh_token?: unknown };
    const refresh =
      parsed?.token?.refresh_token ?? parsed?.refresh_token ?? null;
    const hasRefreshToken = typeof refresh === "string" && refresh.length > 0;
    return {
      path,
      exists: true,
      modeOctal,
      hasRefreshToken,
      error: hasRefreshToken ? undefined : "no refresh_token field",
    };
  } catch (err) {
    return {
      path,
      exists: true,
      modeOctal,
      hasRefreshToken: false,
      error: err instanceof Error ? err.message : "unreadable",
    };
  }
}

function loginHint(): string {
  return [
    "Bootstrap file auth once (Keychain often fails for MCP/background spawns):",
    `  SSH_CONNECTION='${AGY_SSH_CONNECTION}' SSH_CLIENT='${AGY_SSH_CLIENT}' agy`,
    `  test -f ${agyOauthTokenPath()}`,
  ].join("\n");
}

export async function agyDoctor() {
  const bin = agyBin();
  const binPath = await which(bin);
  if (!binPath) {
    return {
      ok: false,
      text: `agy binary not found on PATH (looked for "${bin}"). Install Antigravity CLI or set AGY_BIN.`,
    };
  }

  const token = await inspectOauthTokenFile();
  const tokenLine = token.exists
    ? `token file: present (mode ${token.modeOctal ?? "????"}, refresh_token: ${token.hasRefreshToken ? "yes" : "no"})`
    : `token file: MISSING at ${token.path}`;

  const models = await getAvailableModels();
  if (models.length === 0) {
    const why = token.exists
      ? `"agy models" returned nothing — token file present but auth still failing.`
      : `"agy models" returned nothing — no oauth token file (file-auth required for MCP).`;
    return {
      ok: false,
      text: [`agy found at ${binPath}`, tokenLine, why, loginHint()].join("\n"),
    };
  }

  if (!token.exists || !token.hasRefreshToken) {
    return {
      ok: false,
      text: [
        `agy binary: ${binPath}`,
        `models cache (${models.length}): ${models.join(", ")}`,
        tokenLine,
        "models list works but file token is missing/incomplete — MCP/background may still flap on Keychain.",
        loginHint(),
      ].join("\n"),
    };
  }

  return {
    ok: true,
    text: [
      `agy binary: ${binPath}`,
      `models cache (${models.length}): ${models.join(", ")}`,
      tokenLine,
      `auth: OK (file token + models)`,
    ].join("\n"),
  };
}
